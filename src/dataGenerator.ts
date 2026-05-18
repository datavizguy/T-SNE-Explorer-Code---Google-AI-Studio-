/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  label: 'A' | 'B' | 'C' | 'D' | 'E';
}

export interface EdgeData {
  source_id: string;
  target_id: string;
}

export interface Dataset {
  nodes: NodeData[];
  edges: EdgeData[];
  adjacency: Map<string, string[]>;
}

export function generateDataset(): Dataset {
  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  const adjacency = new Map<string, string[]>();
  const categories: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B', 'C', 'D', 'E'];

  const addEdgeToAdjacency = (s: string, t: string) => {
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s)!.push(t);
    adjacency.get(t)!.push(s);
  };

  // Cluster centers for A-E (t-SNE layout)
  const centers = {
    A: { x: -25, y: -25, z: -25 },
    B: { x: 25, y: -25, z: 25 },
    C: { x: 0, y: 30, z: 0 },
    D: { x: -25, y: 25, z: 25 },
    E: { x: 25, y: 25, z: -25 },
  };

  // Generate 505 nodes (500 + 5 outliers)
  for (let i = 0; i < 500; i++) {
    const label = categories[Math.floor(Math.random() * categories.length)];
    const center = centers[label];
    
    nodes.push({
      id: `node-${i}`,
      x: center.x + (Math.random() - 0.5) * 40,
      y: center.y + (Math.random() - 0.5) * 40,
      z: center.z + (Math.random() - 0.5) * 40,
      cx: 0, cy: 0, cz: 0, // Placeholder
      fx: 0, fy: 0, fz: 0, // Placeholder
      label,
    });
  }

  // Add 5 outlier nodes
  for (let i = 0; i < 5; i++) {
    nodes.push({
      id: `outlier-${i}`,
      x: (Math.random() - 0.5) * 100,
      y: (Math.random() - 0.5) * 100,
      z: (Math.random() - 0.5) * 100,
      cx: 0, cy: 0, cz: 0, // Placeholder
      fx: 0, fy: 0, fz: 0, // Placeholder
      label: categories[Math.floor(Math.random() * categories.length)],
    });
  }

  // Calculate Cluster Layout Coordinates
  // Faces: A=+X, B=-X, C=+Y, D=-Y, E=+Z, Outliers=-Z
  const applyClusterLayout = () => {
    const facePos = 50;
    const scale = 2.25; // Expands the standard +/- 20 range to +/- 45
    
    nodes.forEach(node => {
      const isOutlier = node.id.startsWith('outlier');
      const label = node.label;
      const center = centers[label];
      
      let off1: number;
      let off2: number;

      if (isOutlier) {
        // Outliers are already [-50, 50], just scale slightly to stay inside face borders
        off1 = node.x * 0.9;
        off2 = node.y * 0.9;
      } else {
        // Calculate offsets from cluster center and scale them up
        const dx = (node.x - center.x) * scale;
        const dy = (node.y - center.y) * scale;
        const dz = (node.z - center.z) * scale;

        // Choose which axes map to the face surface based on the fixed axis
        if (label === 'A' || label === 'B') {
          off1 = dy; off2 = dz;
        } else if (label === 'C' || label === 'D') {
          off1 = dx; off2 = dz;
        } else { // E
          off1 = dx; off2 = dy;
        }
      }

      if (isOutlier) {
        node.cx = off1; node.cy = off2; node.cz = -facePos;
      } else if (label === 'A') {
        node.cx = facePos; node.cy = off1; node.cz = off2;
      } else if (label === 'B') {
        node.cx = -facePos; node.cy = off1; node.cz = off2;
      } else if (label === 'C') {
        node.cx = off1; node.cy = facePos; node.cz = off2;
      } else if (label === 'D') {
        node.cx = off1; node.cy = -facePos; node.cz = off2;
      } else if (label === 'E') {
        node.cx = off1; node.cy = off2; node.cz = facePos;
      }
    });

    // Simple one-pass "push" to simulate force-directed spacing on each face
    for (let iter = 0; iter < 3; iter++) {
      nodes.forEach(n1 => {
        nodes.forEach(n2 => {
          if (n1.id === n2.id) return;
          // Check if they are on the same face
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

  // Calculate Flat Layout Coordinates
  // Stacked planes along Y-axis
  const applyFlatLayout = () => {
    const yLevels: Record<string, number> = {
      A: 40,
      B: 20,
      C: 0,
      D: -20,
      E: -40,
    };
    
    nodes.forEach(node => {
      const isOutlier = node.id.startsWith('outlier');
      node.fy = isOutlier ? -60 : yLevels[node.label];
      node.fx = (Math.random() - 0.5) * 80;
      node.fz = (Math.random() - 0.5) * 80;
    });

    // Minimal force-directed pass for Flat layout (2D on each plane)
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

  // Distance helper
  const getDist = (n1: NodeData, n2: NodeData) => {
    return Math.sqrt(
      Math.pow(n1.x - n2.x, 2) + 
      Math.pow(n1.y - n2.y, 2) + 
      Math.pow(n1.z - n2.z, 2)
    );
  };

  // Connect 3-7 nearby nodes for each node
  const edgeSet = new Set<string>();

  nodes.forEach((node) => {
    // Sort all other nodes by distance
    const others = nodes
      .filter((n) => n.id !== node.id)
      .map((n) => ({ id: n.id, dist: getDist(node, n) }))
      .sort((a, b) => a.dist - b.dist);

    const numEdges = Math.floor(Math.random() * 5) + 3; // 3 to 7
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

  // Add a small number of random inter-cluster edges
  for (let i = 0; i < 20; i++) {
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

  return { nodes, edges, adjacency };
}
