import sys
import json
import networkx as nx
import math

def solve_route(data):
    airports = data['airports']
    routes = data['routes']
    source_code = data['source']
    dest_code = data['destination']
    priority = data.get('priority', 'time') # time / fuel / safety

    G = nx.DiGraph()

    # Add nodes
    airport_map = {a['code']: a for a in airports}
    for code, info in airport_map.items():
        # Congestion Impact: 1-10 scale
        G.add_node(code, lat=info['lat'], lon=info['lon'], congestion=info['congestionLevel'])

    # Add edges with weights
    for r in routes:
        # HARD CONSTRAINT: Airspace restriction
        if r.get('isRestricted', False):
            continue

        src = r['source']
        dst = r['destination']
        
        if src not in airport_map or dst not in airport_map:
            continue
            
        distance = r['distance']
        fuel = r['avgFuelConsumption'] * distance
        
        # Weather Severity Impact
        weather_penalty = 1.0
        severity = r.get('weatherSeverity', 'Low')
        if severity == 'High': weather_penalty = 3.5
        elif severity == 'Medium': weather_penalty = 1.8
        
        congestion = airport_map[dst]['congestionLevel']
        
        # Dynamic Cost Function
        if priority == 'fuel':
            # Fuel + small weather impact
            weight = fuel * (1 + (weather_penalty * 0.2))
        elif priority == 'safety':
            # Massive priority on avoiding weather and congestion
            weight = distance * weather_penalty * (1 + (congestion / 5))
        else:
            # Default: Fastest Time (Distance + Congestion)
            # Normalize congestion to a time factor (1-10 level adds significant delay)
            weight = (distance / 850) * weather_penalty * (1 + (congestion / 10))

        G.add_edge(src, dst, 
                   weight=weight, 
                   distance=distance, 
                   fuel=fuel, 
                   severity=severity, 
                   congestion=congestion)

    try:
        # Run Dijkstra
        path = nx.dijkstra_path(G, source_code, dest_code, weight='weight')
        
        # Calculate Metrics
        total_dist = 0
        total_fuel = 0
        weather_impacts = []
        congestion_impacts = []
        
        for i in range(len(path)-1):
            e = G.get_edge_data(path[i], path[i+1])
            total_dist += e['distance']
            total_fuel += e['fuel']
            weather_impacts.append(e['severity'])
            congestion_impacts.append(e['congestion'])

        return {
            "status": "success",
            "path": path,
            "metrics": {
                "distance": round(total_dist, 2),
                "fuel": round(total_fuel, 2),
                "time": round((total_dist / 850) * (sum(congestion_impacts)/len(congestion_impacts)/5 + 1), 1),
                "avg_weather": max(set(weather_impacts), key=weather_impacts.count) if weather_impacts else 'Low',
                "avg_congestion": round(sum(congestion_impacts)/len(congestion_impacts), 1)
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        result = solve_route(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "message": "Python Engine Error: " + str(e)}))
