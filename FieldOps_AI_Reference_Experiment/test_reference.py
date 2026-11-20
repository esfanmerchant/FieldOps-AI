"""Smoke tests for the report-generated reference experiment.
Not tests of the students' unprovided application/repository.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from reference_experiment import *

def run_tests():
    log=[]
    graph,techs,jobs=make_scenario(1000)
    _,costs,_=build_costs(graph,techs,jobs)
    ev=ScheduleEvaluator(techs,jobs,costs)
    base=NearestEligibleDispatcher().optimize(ev)
    log.append(('Typical generated scenario',bool(base[2]['served']>0 and base[2]['violations']==0),'Schedule produced with positive served count; zero accepted violations'))
    try:
        Path('/nonexistent_fieldops_example.json').read_text()
        log.append(('Missing input file',False,'No exception'))
    except FileNotFoundError:
        log.append(('Missing input file',True,'FileNotFoundError raised; user-facing handling not built'))
    # The reference scenario has no formal input validator: this is a documented gap.
    log.append(('Invalid negative service duration',False,'Dedicated input validator not implemented in reference script'))
    disconnected={i:[] for i in range(64)}
    dist,path=AStarRouter(disconnected).find_path(0,1)
    log.append(('Disconnected road graph',dist==float('inf') and path==[],'A* returned infinite cost and empty path'))
    result,trace=GeneticOptimizer(population=8,generations=2).optimize(ev,base,42)
    log.append(('Low optimizer generation cap',len(trace)==3 and result['violations']==0,'Stopped after two generations; valid best-so-far returned'))
    hardjob=Job(0,0,'unavailable_licence',30,480,1000,1)
    check=ConstraintChecker(techs,[hardjob],costs)
    log.append(('Skill not available',all(check.try_append(t,t.start_node,480,hardjob) is None for t in techs),'All infeasible job-to-technician assignments rejected'))
    for i,(name,passed,info) in enumerate(log,1):print(f'{i}. {"PASS" if passed else "GAP "} | {name}: {info}')
    return log
if __name__=='__main__':run_tests()
