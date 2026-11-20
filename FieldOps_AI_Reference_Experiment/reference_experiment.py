"""FieldOps AI report-generated reference experiment (NOT a user's repository).
Reproducible demonstration with synthetic data and an offline road grid.
Run: python reference_experiment.py [--out output_folder]
No personal/real service data is used.
"""
from __future__ import annotations
import argparse,csv,heapq,math,random,time,platform,sys,collections,json,statistics
from dataclasses import dataclass
from pathlib import Path

GRID=8; NODES=GRID*GRID; KM=0.8; SPEED_KMH=30; MIN_PER_UNIT=60*KM/SPEED_KMH
SKILLS=('electrical','plumbing','hvac')

@dataclass(frozen=True)
class Job:
    id:int; node:int; skill:str; duration:int; start:int; end:int; priority:int
@dataclass(frozen=True)
class Technician:
    id:int; start_node:int; skills:tuple[str,...]; shift_start:int=480; shift_end:int=1020

class AStarRouter:
    def __init__(self,graph):
        self.graph=graph;self.calls=0;self.nodes_expanded=0
    def heuristic(self,n,goal):
        x,y=divmod(n,GRID);X,Y=divmod(goal,GRID)
        return abs(x-X)+abs(y-Y)  # minimum edge weight = 1
    def find_path(self,start,goal):
        self.calls+=1
        if start==goal:return 0.0,[start]
        heap=[(self.heuristic(start,goal),0.0,start)]
        cost={start:0.0};parent={}
        while heap:
            _,g,u=heapq.heappop(heap)
            if g>cost[u]+1e-9:continue
            self.nodes_expanded+=1
            if u==goal:
                path=[u]
                while u in parent:
                    u=parent[u];path.append(u)
                return g,list(reversed(path))
            for v,w in self.graph[u]:
                cand=g+w
                if cand<cost.get(v,float('inf'))-1e-9:
                    cost[v]=cand;parent[v]=u
                    heapq.heappush(heap,(cand+self.heuristic(v,goal),cand,v))
        return float('inf'),[]

class ConstraintChecker:
    def __init__(self,techs,jobs,costs):self.techs=techs;self.jobs=jobs;self.costs=costs
    def try_append(self,tech,loc,clock,job):
        if job.skill not in tech.skills:return None
        dist=self.costs[(loc,job.node)]
        if not math.isfinite(dist):return None
        arrival=clock+dist*MIN_PER_UNIT
        begins=max(arrival,job.start)
        finish=begins+job.duration
        if finish>job.end or finish>tech.shift_end:return None
        return (job.node,finish,dist,arrival,begins)

class ScheduleEvaluator:
    def __init__(self,techs,jobs,costs):
        self.techs=techs;self.jobs=jobs;self.check=ConstraintChecker(techs,jobs,costs)
    def evaluate(self,order,genes):
        routes=[[] for _ in self.techs]; states=[(t.start_node,t.shift_start) for t in self.techs]
        visited=set();dist=0.0;waiting=0.0;unserved=[]
        for jid in order:
            if jid in visited:continue
            j=self.jobs[jid];ti=genes[jid];t=self.techs[ti]
            loc,clock=states[ti]
            nxt=self.check.try_append(t,loc,clock,j)
            if nxt is None:unserved.append(jid);continue
            nextloc,finish,d,arrive,begins=nxt
            dist+=d;waiting+=max(0,begins-arrive)
            states[ti]=(nextloc,finish)
            routes[ti].append(jid);visited.add(jid)
        unserved=list(set(range(len(self.jobs)))-visited)
        score=dist+42*sum(1+.25*(self.jobs[j].priority-1) for j in unserved)+0.025*waiting
        return {'score':score,'travel_km':dist*KM,'served':len(visited),
                'on_time_rate':1.0 if visited else 0.0,'overtime_min':0,'violations':0,
                'unserved':unserved,'routes':routes,'waiting_min':waiting,'travel_units':dist}

class NearestEligibleDispatcher:
    def optimize(self,ev):
        jobs=ev.jobs;techs=ev.techs
        states=[(t.start_node,t.shift_start) for t in techs];routes=[[] for _ in techs];
        genes=[0]*len(jobs);order=[];remaining=set(range(len(jobs)))
        while remaining:
            # Earliest-deadline next; nearest feasible technician for that job.
            jid=min(remaining,key=lambda x:(jobs[x].end,jobs[x].start,x))
            remaining.remove(jid);j=jobs[jid]
            options=[]
            for ti,t in enumerate(techs):
                loc,clock=states[ti]
                feasible=ev.check.try_append(t,loc,clock,j)
                if feasible:
                    options.append((feasible[2],ti,feasible))
            if options:
                _,ti,(loc,finish,d,a,b)=min(options)
                genes[jid]=ti;states[ti]=(loc,finish);routes[ti].append(jid);order.append(jid)
            else:
                order.append(jid)
                compatible=[i for i,t in enumerate(techs) if j.skill in t.skills]
                genes[jid]=compatible[0] if compatible else 0
        result=ev.evaluate(order,genes)
        return order,genes,result

class GeneticOptimizer:
    def __init__(self,population=36,generations=50,mutation=.32,crossover=.8):
        self.population=population;self.generations=generations
        self.mutation=mutation;self.crossover=crossover
    def optimize(self,ev,baseline,seed):
        rng=random.Random(seed);n=len(ev.jobs);ntech=len(ev.techs)
        base_order,base_genes,_=baseline
        compatible=[[i for i,t in enumerate(ev.techs) if j.skill in t.skills] or [0] for j in ev.jobs]
        def random_member():
            order=list(range(n));rng.shuffle(order)
            genes=[rng.choice(compatible[j]) for j in range(n)]
            return order,genes
        def mutate(chrom):
            order,genes=chrom;order=order[:];genes=genes[:]
            if rng.random()<.75:
                i,j=rng.sample(range(n),2);order[i],order[j]=order[j],order[i]
            else:
                i,j=sorted(rng.sample(range(n),2));order[i:j+1]=reversed(order[i:j+1])
            for _ in range(1 if rng.random()<.7 else 2):
                j=rng.randrange(n);genes[j]=rng.choice(compatible[j])
            return order,genes
        def cross(a,b):
            cut1,cut2=sorted(rng.sample(range(n),2))
            child=[None]*n;child[cut1:cut2]=a[0][cut1:cut2]
            fillers=(g for g in b[0] if g not in child)
            for k in range(n):
                if child[k] is None:child[k]=next(fillers)
            childgen=[a[1][j] if rng.random()<.5 else b[1][j] for j in range(n)]
            return child,childgen
        pop=[(base_order[:],base_genes[:])]
        for x in range(self.population-1):
            pop.append(mutate(pop[0]) if x<self.population//3 else random_member())
        best=None;trace=[]
        for gen in range(self.generations+1):
            ranked=sorted(((ev.evaluate(*p)['score'],p) for p in pop),key=lambda r:r[0])
            if best is None or ranked[0][0]<best[0]:best=ranked[0]
            trace.append(best[0]);
            if gen==self.generations:break
            # elitism and tournament selection
            next_pop=[(p[0][:],p[1][:]) for _,p in ranked[:3]]
            def select():
                return min((rng.choice(ranked) for _ in range(3)),key=lambda row:row[0])[1]
            while len(next_pop)<self.population:
                a=select();b=select()
                kid=cross(a,b) if rng.random()<self.crossover else (a[0][:],a[1][:])
                if rng.random()<self.mutation:kid=mutate(kid)
                next_pop.append(kid)
            pop=next_pop
        result=ev.evaluate(*best[1]);return result,trace

def build_graph(seed):
    rng=random.Random(seed);graph={i:[] for i in range(NODES)}
    for i in range(NODES):
        x,y=divmod(i,GRID)
        for dx,dy in [(1,0),(0,1)]:
            xx,yy=x+dx,y+dy
            if xx>=GRID or yy>=GRID:continue
            v=xx*GRID+yy;w=rng.choice([1,1,1,1.15,1.3,1.5])
            graph[i].append((v,w));graph[v].append((i,w))
    return graph

def make_scenario(seed):
    rng=random.Random(seed); graph=build_graph(seed)
    nt=rng.choice([3,4,5]);nj=rng.choice([10,12,14,16])
    techs=[]
    for i in range(nt):
        subset=tuple(s for s in SKILLS if rng.random()<.7)
        if not subset:subset=(rng.choice(SKILLS),)
        techs.append(Technician(i,rng.randrange(NODES),subset))
    jobs=[]
    for j in range(nj):
        skill=rng.choice(SKILLS)
        start=rng.choice([490,520,550,580,610,650,690,730,770,810,850])
        width=rng.choice([110,140,170,190,210])
        jobs.append(Job(j,rng.randrange(NODES),skill,rng.choice([25,30,40,50,60]),start,min(1020,start+width),rng.choice([1,1,1,2])))
    return graph,techs,jobs

def build_costs(graph,techs,jobs):
    router=AStarRouter(graph)
    nodes=set([t.start_node for t in techs]+[j.node for j in jobs]);costs={}; paths={}
    for s in sorted(nodes):
        for d in sorted(nodes):
            distance,path=router.find_path(s,d)
            costs[(s,d)]=distance;paths[(s,d)]=path
    return router,costs,paths

def run_all(out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    rows=[];curves=[];samples={};runtime_samples=[]
    for sid in range(20):
        scen_seed=1000+sid
        graph,techs,jobs=make_scenario(scen_seed)
        router,costs,paths=build_costs(graph,techs,jobs)
        ev=ScheduleEvaluator(techs,jobs,costs)
        t0=time.perf_counter();baseline=NearestEligibleDispatcher().optimize(ev)
        baseline_s=time.perf_counter()-t0
        rows.append({'scenario':sid+1,'scenario_seed':scen_seed,'algorithm':'nearest-eligible','optimizer_seed':'-',
            'jobs':len(jobs),'technicians':len(techs),'astar_expanded':router.nodes_expanded,
            'runtime_ms':round(1000*baseline_s,4),**{k:round(v,3) if isinstance(v,float) else v for k,v in baseline[2].items() if k not in ('unserved','routes')}})
        if sid==0:samples={'graph':graph,'techs':techs,'jobs':jobs,'baseline':baseline[2],'paths':paths}
        for trial in range(2):
            seed=50000+sid*7+trial
            t0=time.perf_counter();opt,trace=GeneticOptimizer().optimize(ev,baseline,seed)
            elapsed=time.perf_counter()-t0
            rows.append({'scenario':sid+1,'scenario_seed':scen_seed,'algorithm':'genetic-optimizer','optimizer_seed':seed,
             'jobs':len(jobs),'technicians':len(techs),'astar_expanded':router.nodes_expanded,
             'runtime_ms':round(1000*elapsed,4),**{k:round(v,3) if isinstance(v,float) else v for k,v in opt.items() if k not in ('unserved','routes')}})
            if trial==0:
                curves.append(trace)
                if sid==0:samples['genetic']=opt
    with open(out/'results.csv','w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    with open(out/'convergence.csv','w',newline='') as f:
        w=csv.writer(f);w.writerow(['scenario','generation','best_score'])
        for sid,trace in enumerate(curves,1):
            for gen,score in enumerate(trace):w.writerow([sid,gen,round(score,4)])
    with open(out/'report_run.json','w') as f:
        json.dump({'python':sys.version.split()[0],'platform':platform.platform(),
        'scenario_seeds':list(range(1000,1020)), 'optimization_seeds':'50000 + scenario_index*7 + trial_index, trial_index=0,1',
        'graphs':'8x8 undirected generated grid with nonnegative edge costs',
        'baseline':'earliest-window-end job first; nearest feasible technician',
        'ga':{'population':36,'generations':50,'mutation_probability':.32,'crossover_probability':.8},
        'distance_km':'A* sum of edge weights times 0.8', 'route_time':'60*distance_km/30 mph? (km/h=30)',
        'scope':'Report-generated reference demonstration; not evidence that the student repository has this implementation'},f,indent=2)
    # Serialize easy-to-plot sample without private data
    samp={'techs':[{'id':t.id,'start_node':t.start_node,'skills':t.skills} for t in samples['techs']],
      'jobs':[{'id':j.id,'node':j.node,'skill':j.skill,'duration':j.duration,'start':j.start,'end':j.end} for j in samples['jobs']],
      'baseline_routes':samples['baseline']['routes'],'ga_routes':samples['genetic']['routes'],
      'graph':{str(k):[[n,w] for n,w in v] for k,v in samples['graph'].items()},
      'paths':{str(s)+'_'+str(d):path for (s,d),path in samples['paths'].items()}}
    (out/'sample_scenario.json').write_text(json.dumps(samp,indent=2))
    return rows,curves

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',default='demo_results');args=parser.parse_args()
    rows,curves=run_all(args.out)
    for algo in ['nearest-eligible','genetic-optimizer']:
        rr=[r for r in rows if r['algorithm']==algo]
        print(algo, 'N',len(rr), 'mean travel km',round(statistics.mean(x['travel_km'] for x in rr),2),
         'mean served',round(statistics.mean(x['served'] for x in rr),2),'mean objective',round(statistics.mean(x['score'] for x in rr),2),
         'mean ms',round(statistics.mean(x['runtime_ms'] for x in rr),2))
