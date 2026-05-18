/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Line } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sun, 
  Moon, 
  Layers, 
  Download, 
  Maximize2, 
  Minimize2, 
  Eye, 
  EyeOff,
  Info,
  Share2
} from 'lucide-react';
import { generateDataset, Dataset, NodeData, EdgeData } from './dataGenerator';

// --- Types & Constants ---

const CATEGORY_COLORS: Record<string, string> = {
  A: '#3B82F6',
  B: '#10B981',
  C: '#F59E0B',
  D: '#8B5CF6',
  E: '#EF4444',
};

const LIGHT_BG = '#F9FAFB';
const DARK_BG = '#030712';
const GRAY_OUT = '#F3F4F6';

// --- Scene Renderer (Optimized) ---

interface SceneRendererProps {
  dataset: Dataset;
  selectionInfo: { highlightedNodes: Set<string>; highlightedEdges: Set<string> };
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  selectedCluster: string | null;
  layoutMode: 'tsne' | 'cluster' | 'flat';
  theme: 'light' | 'dark';
  onNodeClick: (id: string) => void;
  onNodeHover: (id: string | null) => void;
}

const SceneRenderer = ({ 
  dataset, 
  selectionInfo, 
  selectedNodeId, 
  hoveredNodeId,
  selectedCluster,
  layoutMode, 
  theme,
  showEdges,
  onNodeClick,
  onNodeHover
}: SceneRendererProps & { showEdges: boolean }) => {
  const nodesMeshRef = useRef<THREE.InstancedMesh>(null);
  const edgesMeshRef = useRef<THREE.LineSegments>(null);
  const highlightedEdgesMeshRef = useRef<THREE.InstancedMesh>(null);
  const instMatrix = useMemo(() => new THREE.Matrix4(), []);
  const edgeMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const vecSource = useMemo(() => new THREE.Vector3(), []);
  const vecTarget = useMemo(() => new THREE.Vector3(), []);
  const vecDir = useMemo(() => new THREE.Vector3(), []);
  const vecCenter = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const stickScale = useMemo(() => new THREE.Vector3(), []);
  const defaultDir = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  
  // Persistent node state for lerping
  const nodesState = useMemo(() => dataset.nodes.map(n => ({
    currentPos: new THREE.Vector3(n.x, n.y, n.z),
    currentScale: 1,
    currentColor: new THREE.Color(CATEGORY_COLORS[n.label])
  })), [dataset]);

  // Map for quick edge lookups
  const nodeIndexMap = useMemo(() => {
    const map: Record<string, number> = {};
    dataset.nodes.forEach((n, i) => map[n.id] = i);
    return map;
  }, [dataset]);

  // Edges geometry
  const edgeGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(dataset.edges.length * 6);
    const colors = new Float32Array(dataset.edges.length * 6);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [dataset.edges.length]);

  useFrame((state) => {
    if (!nodesMeshRef.current) return;

    const bgColor = theme === 'light' ? LIGHT_BG : DARK_BG;
    const isAnySelected = !!selectedNodeId || !!selectedCluster;

    // --- 1. Update Nodes ---
    dataset.nodes.forEach((node, i) => {
      const s = nodesState[i];
      let targetPos: [number, number, number];
      
      if (layoutMode === 'tsne') {
        targetPos = [node.x, node.y, node.z];
      } else if (layoutMode === 'cluster') {
        targetPos = [node.cx, node.cy, node.cz];
      } else {
        targetPos = [node.fx, node.fy, node.fz];
      }
      
      const targetVec = new THREE.Vector3(...targetPos);
      s.currentPos.lerp(targetVec, 0.1);

      // Pulsate / Scale
      let targetScale = 1;
      if (selectedNodeId === node.id) {
        targetScale = 1.3 + Math.sin(state.clock.elapsedTime * 6) * 0.3;
      } else if (hoveredNodeId === node.id) {
        targetScale = 1.2;
      } else if (isAnySelected && !selectionInfo.highlightedNodes.has(node.id)) {
        targetScale = 0.8;
      }
      s.currentScale = THREE.MathUtils.lerp(s.currentScale, targetScale, 0.1);

      // Color lerp
      let targetColorString = CATEGORY_COLORS[node.label];
      const isHighlighted = selectionInfo.highlightedNodes.has(node.id);
      
      if (isAnySelected && !isHighlighted) {
        // Use an even lighter gray and increase lerp with background to simulate 50% transparency
        tempColor.set(GRAY_OUT).lerp(new THREE.Color(bgColor), 0.6);
      } else {
        tempColor.set(targetColorString);
      }
      s.currentColor.lerp(tempColor, 0.1);

      // Update Instance Matrix
      instMatrix.makeTranslation(s.currentPos.x, s.currentPos.y, s.currentPos.z);
      instMatrix.scale(new THREE.Vector3(s.currentScale, s.currentScale, s.currentScale));
      nodesMeshRef.current!.setMatrixAt(i, instMatrix);
      nodesMeshRef.current!.setColorAt(i, s.currentColor);
    });

    nodesMeshRef.current.instanceMatrix.needsUpdate = true;
    if (nodesMeshRef.current.instanceColor) nodesMeshRef.current.instanceColor.needsUpdate = true;

    // --- 2. Update Edges ---
    let highlightedEdgeCount = 0;
    
    if (showEdges) {
      const posAttr = edgeGeometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = edgeGeometry.getAttribute('color') as THREE.BufferAttribute;
      
      dataset.edges.forEach((edge, i) => {
        const idxS = nodeIndexMap[edge.source_id];
        const idxT = nodeIndexMap[edge.target_id];
        const sourceState = nodesState[idxS];
        const targetState = nodesState[idxT];

        const edgeKey = `${edge.source_id}--${edge.target_id}`;
        const isHighlighted = selectionInfo.highlightedEdges.has(edgeKey);

        if (isHighlighted && highlightedEdgesMeshRef.current) {
          // Add to thick edges mesh
          vecSource.copy(sourceState.currentPos);
          vecTarget.copy(targetState.currentPos);
          
          vecDir.subVectors(vecTarget, vecSource);
          const distance = vecDir.length();
          vecCenter.addVectors(vecSource, vecTarget).multiplyScalar(0.5);
          
          // Orientation
          quat.setFromUnitVectors(defaultDir, vecDir.clone().normalize());
          
          // Thickness: highlighted nodes are 1.2-1.3 scale, so 0.4 thickness for edges is significant
          stickScale.set(distance, 0.4, 0.4);
          
          edgeMatrix.makeRotationFromQuaternion(quat);
          edgeMatrix.setPosition(vecCenter);
          edgeMatrix.scale(stickScale);
          
          highlightedEdgesMeshRef.current.setMatrixAt(highlightedEdgeCount, edgeMatrix);
          
          tempColor.set(CATEGORY_COLORS[dataset.nodes[idxS].label]).offsetHSL(0, 0, 0.1);
          highlightedEdgesMeshRef.current.setColorAt(highlightedEdgeCount, tempColor);
          
          highlightedEdgeCount++;

          // Hide from thin mesh
          posAttr.setXYZ(i * 2, 0, 0, 0);
          posAttr.setXYZ(i * 2 + 1, 0, 0, 0);
        } else {
          // standard thin line
          posAttr.setXYZ(i * 2, sourceState.currentPos.x, sourceState.currentPos.y, sourceState.currentPos.z);
          posAttr.setXYZ(i * 2 + 1, targetState.currentPos.x, targetState.currentPos.y, targetState.currentPos.z);

          if (isAnySelected) {
            tempColor.set(GRAY_OUT).lerp(new THREE.Color(bgColor), 0.5);
          } else {
            tempColor.set(CATEGORY_COLORS[dataset.nodes[idxS].label]).lerp(new THREE.Color(bgColor), 0.3);
          }
          
          colorAttr.setXYZ(i * 2, tempColor.r, tempColor.g, tempColor.b);
          colorAttr.setXYZ(i * 2 + 1, tempColor.r, tempColor.g, tempColor.b);
        }
      });

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    }

    if (highlightedEdgesMeshRef.current) {
      highlightedEdgesMeshRef.current.count = highlightedEdgeCount;
      highlightedEdgesMeshRef.current.instanceMatrix.needsUpdate = true;
      if (highlightedEdgesMeshRef.current.instanceColor) highlightedEdgesMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  // Raycasting for InstancedMesh
  const handleNodeClick = (e: any) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) {
      onNodeClick(dataset.nodes[e.instanceId].id);
    }
  };

  const handlePointerMove = (e: any) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) {
      onNodeHover(dataset.nodes[e.instanceId].id);
    } else {
      onNodeHover(null);
    }
  };

  return (
    <group>
      <instancedMesh
        ref={nodesMeshRef}
        args={[undefined, undefined, dataset.nodes.length]}
        onClick={handleNodeClick}
        onPointerMove={handlePointerMove}
        onPointerOut={() => onNodeHover(null)}
      >
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshStandardMaterial roughness={0.3} metalness={0.2} transparent opacity={0.9} />
      </instancedMesh>

      {showEdges && (
        <>
          <lineSegments ref={edgesMeshRef} geometry={edgeGeometry}>
            <lineBasicMaterial vertexColors transparent opacity={0.6} linewidth={1} />
          </lineSegments>
          
          <instancedMesh 
            ref={highlightedEdgesMeshRef} 
            args={[undefined, undefined, dataset.edges.length]}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial transparent opacity={0.9} />
          </instancedMesh>
        </>
      )}
    </group>
  );
};

// --- Main App Component ---

export default function App() {
  const [dataset] = useState<Dataset>(generateDataset);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showLegend, setShowLegend] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [layoutMode, setLayoutMode] = useState<'tsne' | 'cluster' | 'flat'>('tsne');

  // Shared ref to track node positions for edges
  const positionsRef = useRef<Record<string, THREE.Vector3>>({});

  // Derive highlighted elements based on selection
  const selectionInfo = useMemo(() => {
    const highlightedNodes = new Set<string>();
    const highlightedEdges = new Set<string>();

    if (selectedNodeId) {
      highlightedNodes.add(selectedNodeId);
      
      // Efficient BFS for 3 degrees using adjacency list
      let currentLevel = new Set([selectedNodeId]);
      for (let i = 0; i < 3; i++) {
        const nextLevel = new Set<string>();
        currentLevel.forEach(nodeId => {
          const neighbors = dataset.adjacency.get(nodeId) || [];
          neighbors.forEach(neighborId => {
            if (!highlightedNodes.has(neighborId)) {
              highlightedNodes.add(neighborId);
              nextLevel.add(neighborId);
            }
          });
        });
        if (nextLevel.size === 0) break;
        currentLevel = nextLevel;
      }

      // Identify edges between highlighted nodes
      dataset.edges.forEach(edge => {
        if (highlightedNodes.has(edge.source_id) && highlightedNodes.has(edge.target_id)) {
          highlightedEdges.add(`${edge.source_id}--${edge.target_id}`);
        }
      });
    } else if (selectedCluster) {
      dataset.nodes.forEach(node => {
        if (node.label === selectedCluster) highlightedNodes.add(node.id);
      });
      dataset.edges.forEach(edge => {
        const s = dataset.nodes.find(n => n.id === edge.source_id);
        const t = dataset.nodes.find(n => n.id === edge.target_id);
        if (s?.label === selectedCluster && t?.label === selectedCluster) {
          highlightedEdges.add(`${edge.source_id}--${edge.target_id}`);
        }
      });
    }

    return { highlightedNodes, highlightedEdges };
  }, [selectedNodeId, selectedCluster, dataset]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');
  const toggleEdges = () => setShowEdges(prev => !prev);

  const onNodeClick = (id: string) => {
    setSelectedNodeId(prev => prev === id ? null : id);
    setSelectedCluster(null);
  };

  const onClusterClick = (label: string) => {
    setSelectedCluster(prev => prev === label ? null : label);
    setSelectedNodeId(null);
  };

  const clearSelection = () => {
    setSelectedNodeId(null);
    setSelectedCluster(null);
  };

  const downloadCSV = () => {
    const activeNodes = selectionInfo.highlightedNodes.size > 0 
      ? dataset.nodes.filter(n => selectionInfo.highlightedNodes.has(n.id))
      : dataset.nodes;
    
    const activeEdges = selectionInfo.highlightedEdges.size > 0
      ? dataset.edges.filter(e => selectionInfo.highlightedEdges.has(`${e.source_id}--${e.target_id}`))
      : dataset.edges;

    let csvContent = "data:text/csv;charset=utf-8,Type,ID/Source,Label/Target,X,Y,Z\n";
    activeNodes.forEach(n => {
      csvContent += `Node,${n.id},${n.label},${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}\n`;
    });
    activeEdges.forEach(e => {
      csvContent += `Edge,${e.source_id},${e.target_id},,,, \n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `tsne_data_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const hoveredNode = useMemo(() => 
    dataset.nodes.find(n => n.id === hoveredNodeId), 
    [hoveredNodeId, dataset]
  );

  return (
    <div className={`w-full h-screen overflow-hidden transition-colors duration-500 ${theme === 'dark' ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`} style={{ fontFamily: 'var(--font-sans)', '--font-sans': '"Inter", sans-serif' } as any}>
      {/* 3D Scene */}
      <Canvas shadows dpr={[1, 1.5]} performance={{ min: 0.5 }} onPointerMissed={clearSelection}>
        <color attach="background" args={[theme === 'light' ? LIGHT_BG : DARK_BG]} />
        <PerspectiveCamera makeDefault position={[120, 120, 120]} fov={45} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        
        <ambientLight intensity={theme === 'light' ? 0.8 : 0.4} />
        <pointLight position={[100, 100, 100]} intensity={1.5} />
        <pointLight position={[-100, -100, -100]} intensity={0.5} />

        {/* Bounding Cube */}
        <mesh>
          <boxGeometry args={[110, 110, 110]} />
          <meshBasicMaterial color={theme === 'light' ? '#E5E7EB' : '#1F2937'} wireframe transparent opacity={0.3} />
        </mesh>

        <SceneRenderer
          dataset={dataset}
          selectionInfo={selectionInfo}
          selectedNodeId={selectedNodeId}
          hoveredNodeId={hoveredNodeId}
          selectedCluster={selectedCluster}
          layoutMode={layoutMode}
          theme={theme}
          showEdges={showEdges}
          onNodeClick={onNodeClick}
          onNodeHover={setHoveredNodeId}
        />
      </Canvas>

      {/* --- Overlay UI (HUD) --- */}

      {/* Layout Toggle */}
      <div className="fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-30 p-1 rounded-2xl border shadow-2xl flex gap-1 backdrop-blur-md transition-colors"
        style={{ 
          backgroundColor: theme === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(17,24,39,0.7)',
          borderColor: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
        }}
      >
        <button
          onClick={() => setLayoutMode('tsne')}
          className={`px-3 sm:px-6 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${layoutMode === 'tsne' ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 text-current'}`}
        >
          t-SNE
        </button>
        <button
          onClick={() => setLayoutMode('cluster')}
          className={`px-3 sm:px-6 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${layoutMode === 'cluster' ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 text-current'}`}
        >
          Cluster
        </button>
        <button
          onClick={() => setLayoutMode('flat')}
          className={`px-3 sm:px-6 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${layoutMode === 'flat' ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 text-current'}`}
        >
          Flat
        </button>
      </div>

      {/* Hover Tooltip Overlay */}
      <AnimatePresence>
        {hoveredNode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed pointer-events-none z-50 p-4 rounded-xl border backdrop-blur-md shadow-2xl"
            style={{ 
              top: '20px', 
              right: '20px',
              backgroundColor: theme === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(17,24,39,0.85)',
              borderColor: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
            }}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white shadow-lg" style={{ backgroundColor: CATEGORY_COLORS[hoveredNode.label] }}>
                {hoveredNode.label}
              </div>
              <div>
                <h3 className="text-sm font-mono opacity-50 uppercase tracking-widest">Node ID</h3>
                <p className="text-lg font-bold">{hoveredNode.id}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-[10px] uppercase tracking-tighter opacity-50">X Position</div>
                  <div className="text-xs font-mono">{hoveredNode.x.toFixed(2)}</div>
                  <div className="text-[10px] uppercase tracking-tighter opacity-50">Y Position</div>
                  <div className="text-xs font-mono">{hoveredNode.y.toFixed(2)}</div>
                  <div className="text-[10px] uppercase tracking-tighter opacity-50">Z Position</div>
                  <div className="text-xs font-mono">{hoveredNode.z.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header / Title */}
      <div className="fixed top-6 left-6 sm:top-8 sm:left-8 z-10 select-none">
        <h1 className="text-xl sm:text-3xl font-black tracking-tighter uppercase leading-none">
          t-SNE <span className="text-transparent" style={{ WebkitTextStroke: '1px currentColor' }}>3D</span> Explorer
        </h1>
        <p className="mt-1 text-[8px] sm:text-xs font-mono opacity-60 uppercase tracking-[0.2em]">Experimental Visualisation v1.0</p>
      </div>

      {/* Corner Controls */}
      <div className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 flex flex-col gap-2 sm:gap-4 z-10">
        <button 
          onClick={toggleTheme}
          className="p-3 sm:p-4 rounded-full border shadow-xl hover:scale-110 active:scale-95 transition-all backdrop-blur-sm"
          style={{ 
            backgroundColor: theme === 'light' ? 'white' : '#1F2937',
            borderColor: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'
          }}
        >
          {theme === 'light' ? <Moon size={18} className="sm:w-5 sm:h-5" /> : <Sun size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button 
          onClick={toggleEdges}
          className="p-3 sm:p-4 rounded-full border shadow-xl hover:scale-110 active:scale-95 transition-all backdrop-blur-sm"
          style={{ 
            backgroundColor: theme === 'light' ? 'white' : '#1F2937',
            borderColor: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'
          }}
        >
          <Share2 size={18} className={`sm:w-5 sm:h-5 ${showEdges ? "text-indigo-500" : "opacity-30"}`} />
        </button>
        <button 
          onClick={() => setShowLegend(!showLegend)}
          className="p-3 sm:p-4 rounded-full border shadow-xl hover:scale-110 active:scale-95 transition-all backdrop-blur-sm"
          style={{ 
            backgroundColor: theme === 'light' ? 'white' : '#1F2937',
            borderColor: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'
          }}
        >
          {showLegend ? <EyeOff size={18} className="sm:w-5 sm:h-5" /> : <Eye size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button 
          onClick={downloadCSV}
          className="p-3 sm:p-4 rounded-full border shadow-xl hover:scale-110 active:scale-95 transition-all bg-indigo-600 text-white border-transparent"
        >
          <Download size={18} className="sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* Legend */}
      <AnimatePresence>
        {showLegend && (
          <motion.div 
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -100, opacity: 0 }}
            className="fixed bottom-6 left-6 sm:bottom-8 sm:left-8 p-3 sm:p-6 rounded-2xl sm:rounded-3xl border shadow-2xl backdrop-blur-lg z-10"
            style={{ 
              backgroundColor: theme === 'light' ? 'rgba(255,255,255,0.8)' : 'rgba(17,24,39,0.8)',
              borderColor: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'
            }}
          >
            <div className="flex items-center gap-2 mb-2 sm:mb-4">
              <Layers size={14} className="opacity-50 sm:w-4 sm:h-4" />
              <h2 className="text-[9px] sm:text-xs font-bold uppercase tracking-widest opacity-50">Cluster Legend</h2>
            </div>
            <div className="flex flex-col gap-1 sm:gap-2">
              {Object.entries(CATEGORY_COLORS).map(([label, color]) => (
                <button
                  key={label}
                  onClick={() => onClusterClick(label)}
                  className={`group flex items-center gap-2 sm:gap-4 p-1.5 sm:p-2 rounded-lg sm:rounded-xl transition-all ${selectedCluster === label ? 'bg-white shadow-md' : 'hover:bg-white/50'}`}
                  style={selectedCluster === label ? { color: '#000' } : {}}
                >
                  <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-sm font-bold text-white shadow-sm transition-transform group-hover:scale-110" style={{ backgroundColor: color }}>
                    {label}
                  </div>
                  <span className="text-[10px] sm:text-sm font-medium tracking-tight">Cluster {label}</span>
                  {selectedCluster === label && <div className="ml-auto w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                </button>
              ))}
            </div>
            <div className="mt-4 sm:mt-6 pt-2 sm:pt-4 border-t border-current border-opacity-10 opacity-30 text-[7px] sm:text-[9px] uppercase tracking-tighter">
              Click cluster to filter • Click node for relationship
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interaction Guide */}
      <div className="fixed top-6 right-6 sm:top-8 sm:right-8 flex items-center gap-3 opacity-30 hover:opacity-100 transition-opacity pointer-events-none lg:pointer-events-auto z-20">
        <Info size={14} />
        <span className="text-[10px] font-mono uppercase tracking-widest hidden sm:block">Drag to Rotate • Scroll to Zoom</span>
      </div>
    </div>
  );
}
