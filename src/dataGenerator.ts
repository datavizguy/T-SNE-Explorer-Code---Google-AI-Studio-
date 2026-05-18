/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ClusterLabel = 'Network Leader' | 'Lieutenant' | 'Operative' | 'Financial Agent' | 'Facilitator' | 'Unknown Actor';

export interface NodeData {
  id: string;
  x: number;
  y: number;
  z: number;
  cx: number;
  cy: number;
  cz: number;
  fx: number;
  fy: number;
  fz: number;
  label: ClusterLabel;
  degree: number;
}

export interface EdgeData {
  source_id: string;
  target_id: string;
}

export interface InfluencerData {
  id: string;
  degree: number;
  label: ClusterLabel;
}

export interface Dataset {
  nodes: NodeData[];
  edges: EdgeData[];
  adjacency: Map<string, string[]>;
  topInfluencers: InfluencerData[];
}

export function generateDataset(): Dataset {
  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  const adjacency = new Map<string, string[]>();
  
  const categories: ClusterLabel[] = [
    'Network Leader', 
    'Lieutenant', 
    'Operative', 
    'Financial Agent', 
    'Facilitator'
  ];

  const addEdgeToAdjacency = (s: string, t: string) => {
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s)!.push(t);
    adjacency.get(t)!.push(s);
  };

  // Cluster centers mapping
  const centers: Record<string, {x: number, y: number, z: number}> = {
    'Network Leader': { x: -25, y: -25, z: -25 },
    'Lieutenant': { x: 25, y: -25, z: 25 },
    'Operative': { x: 0, y: 30, z: 0 },
    'Financial Agent': { x: -25, y: 25, z: 25 },
    'Facilitator': { x: 25, y: 25, z: -25 },
  };

  // Generate 500 nodes
  for (let i = 0; i < 500; i++) {
    const label = categories[Math.floor(Math.random() * categories.length)];
    const center = centers[label];
    
    nodes.push({
      id: `node-${i}`,
      x: center.x + (Math.random() - 0.5) * 40,
      y: center.y + (Math.random() - 0.5) * 40,
      z: center.z + (Math.random() - 0.5) * 40,
      cx: 0, cy: 0, cz: 0,
      fx: 0, fy: 0, fz: 0,
      label,
      degree: 0,
    });
  }

  // Add 5 outlier nodes (Unknown Actors)
  for (let i = 0; i < 8; i++) {
    nodes.push({
      id: `actor-${i}`,
      x: (Math.random() - 0.5) * 100,
      y: (Math.random() - 0.5) * 100,
      z: (Math.random() - 0.5) * 100,
      cx: 0, cy: 0, cz: 0,
      fx: 0, fy: 0, fz: 0,
      label: 'Unknown Actor',
      degree: 0,
    });
  }

  // Calculate Cluster Layout Coordinates
  const applyClusterLayout = () => {
    const facePos = 50;
    const scale = 2.25; 
    
    nodes.forEach(node => {
      const label = node.label;
      const isOutlier = label === 'Unknown Actor';
      const center = isOutlier ? {x: 0, y: 0, z: 0} : centers[label];
      
      let off1: number;
      let off2: number;

      if (isOutlier) {
        off1 = node.x * 0.9;
        off2 = node.y * 0.9;
      } else {
        const dx = (node.x - center.x) * scale;
        const dy = (node.y - center.y) * scale;
        const dz = (node.z - center.z) * scale;

        if (label === 'Network Leader' || label === 'Lieutenant') {
          off1 = dy; off2 = dz;
        } else if (label === 'Operative' || label === 'Financial Agent') {
          off1 = dx; off2 = dz;
        } else { // Facilitator
          off1 = dx; off2 = dy;
        }
      }

      if (isOutlier) {
        node.cx = off1; node.cy = off2; node.cz = -facePos;
      } else if (label === 'Network Leader') {
        node.cx = facePos; node.cy = off1; node.cz = off2;
      } else if (label === 'Lieutenant') {
        node.cx = -facePos; node.cy = off1; node.cz = off2;
      } else if (label === 'Operative') {
        node.cx = off1; node.cy = facePos; node.cz = off2;
      } else if (label === 'Financial Agent') {
        node.cx = off1; node.cy = -facePos; node.cz = off2;
      } else if (label === 'Facilitator') {
        node.cx = off1; node.cy = off2; node.cz = facePos;
      }
    });

    for (let iter = 0; iter < 3; iter++) {
      nodes.forEach(n1 => {
        nodes.forEach(n2 => {
          if (n1.id === n2.id) return;
          const sameFace = (n1.cx === n2.cx && Math.abs(n1.cx) === facePos) ||
                           (n1.cy === n2.cy && Math.abs(n1.cy) === facePos) ||
                           (n1.cz === n2.cz && Math.abs(n1.cz) === facePos);
          if (!sameFace) return;
          const dx = n1.cx - n2.cx;
          const dy = n1.cy - n2.cy;
          const dz = n1.cz - n2.cz;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < 16 && distSq > 0) {
            const dist = Math.sqrt(distSq);
            const force = (4 - dist) / dist * 0.5;
            if (n1.cx !== facePos && n1.cx !== -facePos) n1.cx += dx * force;
            if (n1.cy !== facePos && n1.cy !== -facePos) n1.cy += dy * force;
            if (n1.cz !== facePos && n1.cz !== -facePos) n1.cz += dz * force;
          }
        });
      });
    }
  };

  applyClusterLayout();

  const applyFlatLayout = () => {
    const yLevels: Record<string, number> = {
      'Network Leader': 40,
      'Lieutenant': 20,
      'Operative': 0,
      'Financial Agent': -20,
      'Facilitator': -40,
      'Unknown Actor': -60
    };
    
    nodes.forEach(node => {
      node.fy = yLevels[node.label];
      node.fx = (Math.random() - 0.5) * 80;
      node.fz = (Math.random() - 0.5) * 80;
    });

    for (let iter = 0; iter < 3; iter++) {
      nodes.forEach(n1 => {
        nodes.forEach(n2 => {
          if (n1.id === n2.id || n1.fy !== n2.fy) return;
          const dx = n1.fx - n2.fx;
          const dz = n1.fz - n2.fz;
          const distSq = dx * dx + dz * dz;
          if (distSq < 25 && distSq > 0) {
            const dist = Math.sqrt(distSq);
            const force = (5 - dist) / dist * 0.5;
            n1.fx += dx * force;
            n1.fz += dz * force;
          }
        });
      });
    }
  };

  applyFlatLayout();

  const getDist = (n1: NodeData, n2: NodeData) => {
    return Math.sqrt(Math.pow(n1.x-n2.x, 2) + Math.pow(n1.y-n2.y, 2) + Math.pow(n1.z-n2.z, 2));
  };

  const edgeSet = new Set<string>();
  nodes.forEach((node) => {
    const others = nodes
      .filter((n) => n.id !== node.id)
      .map((n) => ({ id: n.id, dist: getDist(node, n) }))
      .sort((a, b) => a.dist - b.dist);

    const numEdges = Math.floor(Math.random() * 5) + 3;
    const nearest = others.slice(0, numEdges);

    nearest.forEach((near) => {
      const edgeId = [node.id, near.id].sort().join('--');
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId);
        edges.push({ source_id: node.id, target_id: near.id });
        addEdgeToAdjacency(node.id, near.id);
      }
    });
  });

  // Cross-cluster connections
  for (let i = 0; i < 30; i++) {
    const n1 = nodes[Math.floor(Math.random() * nodes.length)];
    const n2 = nodes[Math.floor(Math.random() * nodes.length)];
    if (n1.id !== n2.id && n1.label !== n2.label) {
      const edgeId = [n1.id, n2.id].sort().join('--');
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId);
        edges.push({ source_id: n1.id, target_id: n2.id });
        addEdgeToAdjacency(n1.id, n2.id);
      }
    }
  }

  // Set degrees for all nodes
  nodes.forEach(node => {
    node.degree = adjacency.get(node.id)?.length || 0;
  });

  // Calculate Top 4 Influencers by Degree Centrality
  const topInfluencers: InfluencerData[] = nodes
    .map(node => ({
      id: node.id,
      degree: adjacency.get(node.id)?.length || 0,
      label: node.label
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 4);

  return { nodes, edges, adjacency, topInfluencers };
}
