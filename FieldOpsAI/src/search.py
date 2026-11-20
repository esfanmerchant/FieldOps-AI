import heapq
import random
from collections import deque

GRID = 8
NODES = GRID * GRID
ROAD_WEIGHTS = [1, 1, 1, 1.15, 1.3, 1.5]
INF = float("inf")


def node_xy(node, size=GRID):
    return divmod(node, size)


def build_road_graph(seed, size=GRID, closed=()):
    rng = random.Random(seed)
    graph = {i: [] for i in range(size * size)}
    blocked = {frozenset(e) for e in closed}
    for i in range(size * size):
        x, y = divmod(i, size)
        for dx, dy in [(1, 0), (0, 1)]:
            xx, yy = x + dx, y + dy
            if xx >= size or yy >= size:
                continue
            v = xx * size + yy
            w = rng.choice(ROAD_WEIGHTS)
            if frozenset((i, v)) in blocked:
                continue
            graph[i].append((v, w))
            graph[v].append((i, w))
    return graph


def edge_list(graph):
    return [(u, v, w) for u in graph for v, w in graph[u] if u < v]


def manhattan(a, b, size=GRID):
    x, y = divmod(a, size)
    X, Y = divmod(b, size)
    return abs(x - X) + abs(y - Y)


def rebuild_path(parent, node):
    path = [node]
    while node in parent:
        node = parent[node]
        path.append(node)
    return path[::-1]


class AStarRouter:
    def __init__(self, graph, size=GRID):
        self.graph = graph
        self.size = size
        self.calls = 0
        self.nodes_expanded = 0

    def heuristic(self, n, goal):
        return manhattan(n, goal, self.size)

    def find_path(self, start, goal, trace=None):
        self.calls += 1
        if start == goal:
            if trace is not None:
                trace.append(start)
            return 0.0, [start]
        heap = [(self.heuristic(start, goal), 0.0, start)]
        cost = {start: 0.0}
        parent = {}
        while heap:
            _, g, u = heapq.heappop(heap)
            if g > cost[u] + 1e-9:
                continue
            self.nodes_expanded += 1
            if trace is not None:
                trace.append(u)
            if u == goal:
                return g, rebuild_path(parent, u)
            for v, w in self.graph[u]:
                cand = g + w
                if cand < cost.get(v, INF) - 1e-9:
                    cost[v] = cand
                    parent[v] = u
                    heapq.heappush(heap, (cand + self.heuristic(v, goal), cand, v))
        return INF, []


def uniform_cost_search(graph, start, goal):
    frontier = [(0.0, start)]
    cost = {start: 0.0}
    parent = {}
    expanded = []
    done = set()
    while frontier:
        g, u = heapq.heappop(frontier)
        if u in done:
            continue
        done.add(u)
        expanded.append(u)
        if u == goal:
            return g, rebuild_path(parent, u), expanded
        for v, w in graph[u]:
            if g + w < cost.get(v, INF):
                cost[v] = g + w
                parent[v] = u
                heapq.heappush(frontier, (g + w, v))
    return INF, [], expanded


def greedy_best_first(graph, start, goal, size=GRID):
    frontier = [(manhattan(start, goal, size), start)]
    parent = {}
    seen = {start}
    expanded = []
    while frontier:
        _, u = heapq.heappop(frontier)
        expanded.append(u)
        if u == goal:
            path = rebuild_path(parent, u)
            return path_cost(graph, path), path, expanded
        for v, _ in graph[u]:
            if v not in seen:
                seen.add(v)
                parent[v] = u
                heapq.heappush(frontier, (manhattan(v, goal, size), v))
    return INF, [], expanded


def breadth_first_search(graph, start, goal):
    queue = deque([start])
    parent = {}
    seen = {start}
    expanded = []
    while queue:
        u = queue.popleft()
        expanded.append(u)
        if u == goal:
            path = rebuild_path(parent, u)
            return path_cost(graph, path), path, expanded
        for v, _ in graph[u]:
            if v not in seen:
                seen.add(v)
                parent[v] = u
                queue.append(v)
    return INF, [], expanded


def path_cost(graph, path):
    if not path:
        return INF
    total = 0.0
    for a, b in zip(path, path[1:]):
        w = next((w for v, w in graph[a] if v == b), None)
        if w is None:
            raise ValueError(f"no road between {a} and {b}")
        total += w
    return total


def compare_searches(graph, start, goal, size=GRID):
    router = AStarRouter(graph, size)
    trace = []
    cost, path = router.find_path(start, goal, trace)
    runs = {"astar": (cost, path, trace)}
    runs["ucs"] = uniform_cost_search(graph, start, goal)
    runs["greedy"] = greedy_best_first(graph, start, goal, size)
    runs["bfs"] = breadth_first_search(graph, start, goal)
    best = runs["ucs"][0]
    out = {}
    for name, (c, p, exp) in runs.items():
        out[name] = {
            "cost": None if c == INF else round(c, 3),
            "path": p,
            "expanded": exp,
            "nodes_expanded": len(exp),
            "optimal": c != INF and abs(c - best) < 1e-6,
        }
    return out


def heuristic_is_admissible(graph, size=GRID):
    router = AStarRouter(graph, size)
    for s in graph:
        for t, d in dijkstra_all(graph, s).items():
            if router.heuristic(s, t) > d + 1e-9:
                return False
    return True


def dijkstra_all(graph, source):
    dist = {source: 0.0}
    heap = [(0.0, source)]
    while heap:
        g, u = heapq.heappop(heap)
        if g > dist[u]:
            continue
        for v, w in graph[u]:
            if g + w < dist.get(v, INF):
                dist[v] = g + w
                heapq.heappush(heap, (g + w, v))
    return dist


def build_cost_matrix(graph, nodes, size=GRID):
    router = AStarRouter(graph, size)
    costs, paths = {}, {}
    for s in sorted(nodes):
        for d in sorted(nodes):
            costs[(s, d)], paths[(s, d)] = router.find_path(s, d)
    return router, costs, paths
