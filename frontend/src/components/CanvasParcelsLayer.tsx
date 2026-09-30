import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useLeafletContext } from '@react-leaflet/core';
import L from 'leaflet';

export interface CanvasParcelsLayerProps {
  data: any; // GeoJSON FeatureCollection
  interactionMode?: 'draw' | 'select';
  selectedParcelId?: string | number | null;
  scannedBuildingIds?: Set<string | number>;
  onSelectParcel: (feature: any) => void;
  visible?: boolean;
}

const DEG2RAD = Math.PI / 180;

// Fast Spherical Mercator normalization: (lon, lat) -> [0..1]
function latLngToNorm(lat: number, lng: number): [number, number] {
  const normX = 0.5 + lng / 360;
  const sin = Math.max(Math.min(Math.sin(lat * DEG2RAD), 0.999999), -0.999999);
  const normY = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [normX, normY];
}

// Ray-casting point-in-polygon test (px = lon, py = lat)
function pointInPolygon(px: number, py: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  const len = ring.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

interface ProcessedParcel {
  feature: any;
  id: string | number;
  properties: any;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  centerLon: number;
  centerLat: number;
  normCenterX: number;
  normCenterY: number;
  normRings: Float64Array[]; // [normX0, normY0, normX1, normY1, ...]
  rawRing: Array<[number, number]>; // [ [lon, lat], ... ] for hit test
}

export const CanvasParcelsLayer = ({
  data,
  interactionMode = 'draw',
  selectedParcelId = null,
  scannedBuildingIds = new Set(),
  onSelectParcel,
  visible = true,
}: CanvasParcelsLayerProps) => {
  const context = useLeafletContext();
  const map = context.map;

  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoveredParcelIdRef = useRef<string | number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mouseRafRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ lat: number; lng: number } | null>(null);
  const isInteractingRef = useRef<boolean>(false);
  const isAttachedRef = useRef<boolean>(false);

  // Cached canvas buffer dimensions to prevent unnecessary GPU texture reallocations
  const canvasSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Store latest props in ref so callbacks don't trigger layer recreation
  const propsRef = useRef({
    visible,
    selectedParcelId,
    scannedBuildingIds,
    interactionMode,
    onSelectParcel,
  });

  // 1. Process and cache all parcel geometries into normalized Mercator coordinates
  const processedData = useMemo(() => {
    const features = data?.features;
    if (!features || !Array.isArray(features) || features.length === 0) {
      return { parcels: [], grid: new Map<number, number[]>(), bounds: null };
    }

    const parcels: ProcessedParcel[] = [];
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    for (let fIdx = 0; fIdx < features.length; fIdx++) {
      const feat = features[fIdx];
      const props = feat.properties || {};
      const fid = props.parcel_id ?? feat.id ?? `PARCEL-${fIdx}`;
      const geom = feat.geometry;
      if (!geom) continue;

      let rings: number[][][] = [];
      if (geom.type === 'Polygon') {
        rings = geom.coordinates;
      } else if (geom.type === 'MultiPolygon') {
        rings = geom.coordinates[0];
      }
      if (!rings || rings.length === 0 || !rings[0] || rings[0].length === 0) continue;

      const outerRing = rings[0];
      let pMinLon = Infinity, pMaxLon = -Infinity;
      let pMinLat = Infinity, pMaxLat = -Infinity;
      let sumLon = 0, sumLat = 0;

      const normRings: Float64Array[] = [];

      for (let rIdx = 0; rIdx < rings.length; rIdx++) {
        const ring = rings[rIdx];
        const normArr = new Float64Array(ring.length * 2);
        for (let ptIdx = 0; ptIdx < ring.length; ptIdx++) {
          const pt = ring[ptIdx];
          const lon = pt[0];
          const lat = pt[1];
          if (rIdx === 0) {
            if (lon < pMinLon) pMinLon = lon;
            if (lon > pMaxLon) pMaxLon = lon;
            if (lat < pMinLat) pMinLat = lat;
            if (lat > pMaxLat) pMaxLat = lat;
            sumLon += lon;
            sumLat += lat;
          }
          const [nx, ny] = latLngToNorm(lat, lon);
          normArr[ptIdx * 2] = nx;
          normArr[ptIdx * 2 + 1] = ny;
        }
        normRings.push(normArr);
      }

      if (pMinLon < minLon) minLon = pMinLon;
      if (pMaxLon > maxLon) maxLon = pMaxLon;
      if (pMinLat < minLat) minLat = pMinLat;
      if (pMaxLat > maxLat) maxLat = pMaxLat;

      const centerLon = props.longitude !== undefined ? props.longitude : (sumLon / outerRing.length);
      const centerLat = props.latitude !== undefined ? props.latitude : (sumLat / outerRing.length);
      const [normCenterX, normCenterY] = latLngToNorm(centerLat, centerLon);

      parcels.push({
        feature: feat,
        id: fid,
        properties: props,
        minLon: pMinLon,
        maxLon: pMaxLon,
        minLat: pMinLat,
        maxLat: pMaxLat,
        centerLon,
        centerLat,
        normCenterX,
        normCenterY,
        normRings,
        rawRing: outerRing as Array<[number, number]>,
      });
    }

    // Build 2D Spatial Hash Grid for O(1) lightning-fast point lookup
    const GRID_SIZE = 100;
    const cellW = (maxLon - minLon) / GRID_SIZE || 0.001;
    const cellH = (maxLat - minLat) / GRID_SIZE || 0.001;
    const grid = new Map<number, number[]>();

    for (let pIdx = 0; pIdx < parcels.length; pIdx++) {
      const p = parcels[pIdx];
      const gxMin = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.minLon - minLon) / cellW)));
      const gxMax = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.maxLon - minLon) / cellW)));
      const gyMin = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.minLat - minLat) / cellH)));
      const gyMax = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.maxLat - minLat) / cellH)));

      for (let gy = gyMin; gy <= gyMax; gy++) {
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const key = gy * GRID_SIZE + gx;
          let cell = grid.get(key);
          if (!cell) {
            cell = [];
            grid.set(key, cell);
          }
          cell.push(pIdx);
        }
      }
    }

    return {
      parcels,
      grid,
      bounds: { minLon, maxLon, minLat, maxLat, cellW, cellH, GRID_SIZE },
    };
  }, [data]);

  // Fast query to find parcel at [lng, lat]
  const findParcelAt = useCallback((lng: number, lat: number, allowTolerance = false): ProcessedParcel | null => {
    const { parcels, grid, bounds } = processedData;
    if (!bounds || parcels.length === 0) return null;

    if (lng < bounds.minLon || lng > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) {
      return null;
    }

    const gx = Math.max(0, Math.min(bounds.GRID_SIZE - 1, Math.floor((lng - bounds.minLon) / bounds.cellW)));
    const gy = Math.max(0, Math.min(bounds.GRID_SIZE - 1, Math.floor((lat - bounds.minLat) / bounds.cellH)));
    const key = gy * bounds.GRID_SIZE + gx;
    const candidates = grid.get(key);
    if (!candidates) return null;

    // 1. Direct point-in-polygon test (O(1) candidates)
    for (let i = 0; i < candidates.length; i++) {
      const p = parcels[candidates[i]];
      if (lng >= p.minLon && lng <= p.maxLon && lat >= p.minLat && lat <= p.maxLat) {
        if (pointInPolygon(lng, lat, p.rawRing)) {
          return p;
        }
      }
    }

    if (!allowTolerance) return null;

    // 2. Click tolerance fallback for small parcels or touch screens
    const zoom = map.getZoom();
    const pixelToleranceDeg = 0.00025 * Math.pow(2, 14 - zoom);
    let bestParcel: ProcessedParcel | null = null;
    let minDist = pixelToleranceDeg;

    for (let i = 0; i < candidates.length; i++) {
      const p = parcels[candidates[i]];
      const dLon = p.centerLon - lng;
      const dLat = p.centerLat - lat;
      const dist = Math.sqrt(dLon * dLon + dLat * dLat);
      if (dist < minDist) {
        minDist = dist;
        bestParcel = p;
      }
    }

    return bestParcel;
  }, [processedData, map]);

  // Build high-information rich popup HTML
  const buildPopupHTML = useCallback((parcel: ProcessedParcel) => {
    const p = parcel.properties || {};
    const fid = parcel.id;
    const isScanned = propsRef.current.scannedBuildingIds.has(fid) ||
      propsRef.current.scannedBuildingIds.has(String(fid)) ||
      propsRef.current.scannedBuildingIds.has(Number(fid));
    const areaSqm = Number(p.area_size || 0);
    const areaWah = areaSqm > 0 ? (areaSqm / 4.0) : 0;
    const priceWah = Number(p.price_ref || 0);
    const totalVal = Math.round(areaWah * priceWah);

    return `
      <div style="font-family: system-ui, sans-serif; font-size: 12px; color: #f8fafc; min-width: 230px; line-height: 1.5;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding-bottom: 4px;">
          <span style="font-size: 10px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); padding: 2px 6px; border-radius: 4px;">
            ${p.parcel_id || fid || 'PARCEL'}
          </span>
          <span style="font-size: 9px; font-weight: 600; color: #34d399; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 1px 5px; border-radius: 4px;">
            MinIO กรมธนารักษ์
          </span>
        </div>
        <div style="font-weight: 700; font-size: 13px; color: #ffffff; margin-bottom: 5px;">
          📌 ${p.name || p.street || 'แปลงที่ดิน อ.หาดใหญ่'}
        </div>
        ${isScanned ? `
        <div style="display: inline-block; font-size: 10px; font-weight: 700; color: #fca5a5; background: rgba(239, 68, 68, 0.25); border: 1px solid rgba(248, 113, 113, 0.6); padding: 2px 8px; border-radius: 6px; margin-bottom: 6px;">
          📡 ตรวจพบใน AI Radar (200m)
        </div>
        ` : ''}
        <div style="color: #cbd5e1; margin-bottom: 3px;">
          📍 ตำบล: <strong style="color: #f1f5f9;">ต.${p.subdistrict || 'หาดใหญ่'}</strong>, อ.${p.district || 'หาดใหญ่'}
        </div>
        <div style="color: #cbd5e1; margin-bottom: 3px;">
          📐 พื้นที่: <strong style="color: #10b981;">${areaSqm.toLocaleString()} ตร.ม.</strong> <span style="font-size: 11px; color: #94a3b8;">(${areaWah.toLocaleString(undefined, { maximumFractionDigits: 1 })} ตร.ว.)</span>
        </div>
        ${priceWah > 0 ? `
        <div style="color: #cbd5e1; margin-bottom: 3px;">
          💰 ราคาประเมินรัฐ: <strong style="color: #fbbf24;">฿${priceWah.toLocaleString()} / ตร.ว.</strong>
        </div>
        <div style="color: #cbd5e1; margin-bottom: 3px;">
          🏷️ มูลค่าประเมินรวม: <strong style="color: #38bdf8;">฿${totalVal.toLocaleString()} บาท</strong>
        </div>
        ` : ''}
        <div style="color: #cbd5e1; margin-bottom: 4px;">
          🏛️ ประเภท: <span style="color: #93c5fd;">${p.land_type || 'ทั่วไป'}</span>
        </div>
        <div style="font-size: 10px; color: #34d399; margin-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.15); padding-top: 4px; font-weight: 500;">
          🎯 คลิกแปลงนี้เพื่อเลือกและประเมินราคา AI ทันที
        </div>
      </div>
    `;
  }, []);

  // 2. Render all parcels onto Base Canvas without temporary array allocations
  const drawBaseCanvas = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !propsRef.current.visible || !isAttachedRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { parcels } = processedData;
    if (parcels.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const bounds = map.getBounds();
    const padded = bounds.pad(0.3);
    const south = padded.getSouth();
    const north = padded.getNorth();
    const west = padded.getWest();
    const east = padded.getEast();

    const zoom = map.getZoom();
    const scale = 256 * Math.pow(2, zoom);
    const origin = map.getPixelOrigin();
    const originX = origin.x;
    const originY = origin.y;

    const topLeft = map.latLngToLayerPoint(padded.getNorthWest());
    const bottomRight = map.latLngToLayerPoint(padded.getSouthEast());
    const width = Math.max(10, Math.round(bottomRight.x - topLeft.x));
    const height = Math.max(10, Math.round(bottomRight.y - topLeft.y));

    L.DomUtil.setPosition(canvas, topLeft);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);

    // Only resize canvas buffer if dimensions actually changed (prevents GPU memory stalls)
    if (canvasSizeRef.current.w !== targetW || canvasSizeRef.current.h !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvasSizeRef.current = { w: targetW, h: targetH };

      const interCanvas = interactiveCanvasRef.current;
      if (interCanvas) {
        interCanvas.width = targetW;
        interCanvas.height = targetH;
        interCanvas.style.width = `${width}px`;
        interCanvas.style.height = `${height}px`;
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const interCanvas = interactiveCanvasRef.current;
    if (interCanvas) {
      L.DomUtil.setPosition(interCanvas, topLeft);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(-topLeft.x, -topLeft.y);

    const curSelectedId = propsRef.current.selectedParcelId;
    const curScannedIds = propsRef.current.scannedBuildingIds;
    const curMode = propsRef.current.interactionMode;
    const hasScanned = curScannedIds.size > 0;

    // PASS 1: Batch Draw Normal Parcels (Single Path Call)
    ctx.beginPath();
    let hasNormal = false;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (p.maxLon < west || p.minLon > east || p.maxLat < south || p.minLat > north) {
        continue;
      }
      if (curSelectedId !== null && (p.id === curSelectedId || String(p.id) === String(curSelectedId))) {
        continue;
      }
      if (hasScanned && (curScannedIds.has(p.id) || curScannedIds.has(String(p.id)) || curScannedIds.has(Number(p.id)))) {
        continue;
      }

      for (let rIdx = 0; rIdx < p.normRings.length; rIdx++) {
        const ring = p.normRings[rIdx];
        const len = ring.length;
        if (len < 4) continue;
        ctx.moveTo(ring[0] * scale - originX, ring[1] * scale - originY);
        for (let ptIdx = 2; ptIdx < len; ptIdx += 2) {
          ctx.lineTo(ring[ptIdx] * scale - originX, ring[ptIdx + 1] * scale - originY);
        }
        ctx.closePath();
      }
      hasNormal = true;
    }

    if (hasNormal) {
      if (zoom < 14) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
        ctx.fill();
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      } else {
        ctx.fillStyle = curMode === 'select' ? 'rgba(6, 182, 212, 0.25)' : 'rgba(2, 132, 199, 0.32)';
        ctx.fill();
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // PASS 2: Batch Draw AI Radar Scanned Parcels (Glowing Red)
    if (hasScanned) {
      ctx.beginPath();
      let hasHit = false;
      for (let i = 0; i < parcels.length; i++) {
        const p = parcels[i];
        if (p.maxLon < west || p.minLon > east || p.maxLat < south || p.minLat > north) {
          continue;
        }
        if (curSelectedId !== null && (p.id === curSelectedId || String(p.id) === String(curSelectedId))) {
          continue;
        }
        if (!curScannedIds.has(p.id) && !curScannedIds.has(String(p.id)) && !curScannedIds.has(Number(p.id))) {
          continue;
        }

        for (let rIdx = 0; rIdx < p.normRings.length; rIdx++) {
          const ring = p.normRings[rIdx];
          const len = ring.length;
          if (len < 4) continue;
          ctx.moveTo(ring[0] * scale - originX, ring[1] * scale - originY);
          for (let ptIdx = 2; ptIdx < len; ptIdx += 2) {
            ctx.lineTo(ring[ptIdx] * scale - originX, ring[ptIdx + 1] * scale - originY);
          }
          ctx.closePath();
        }
        hasHit = true;
      }

      if (hasHit) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
        ctx.fill();
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }

    // PASS 3: Selected Parcel (Vivid Emerald Green with Glow)
    if (curSelectedId !== null) {
      for (let i = 0; i < parcels.length; i++) {
        const p = parcels[i];
        if (p.id === curSelectedId || String(p.id) === String(curSelectedId)) {
          ctx.save();
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          for (let rIdx = 0; rIdx < p.normRings.length; rIdx++) {
            const ring = p.normRings[rIdx];
            const len = ring.length;
            if (len < 4) continue;
            ctx.moveTo(ring[0] * scale - originX, ring[1] * scale - originY);
            for (let ptIdx = 2; ptIdx < len; ptIdx += 2) {
              ctx.lineTo(ring[ptIdx] * scale - originX, ring[ptIdx + 1] * scale - originY);
            }
            ctx.closePath();
          }
          ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
          ctx.fill();
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 3.5;
          ctx.stroke();
          ctx.restore();
          break;
        }
      }
    }

    ctx.restore();
  }, [processedData, map]);

  // Keep a stable ref to drawBaseCanvas
  const drawBaseCanvasRef = useRef(drawBaseCanvas);

  // Synchronize refs on every update without triggering render-phase warnings
  useEffect(() => {
    propsRef.current = {
      visible,
      selectedParcelId,
      scannedBuildingIds,
      interactionMode,
      onSelectParcel,
    };
    drawBaseCanvasRef.current = drawBaseCanvas;
  });

  // 3. Draw hover highlight on top Interactive Canvas
  const drawHoverHighlight = useCallback((hoveredParcel: ProcessedParcel | null) => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas || !isAttachedRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!hoveredParcel) return;

    const zoom = map.getZoom();
    const scale = 256 * Math.pow(2, zoom);
    const origin = map.getPixelOrigin();
    const originX = origin.x;
    const originY = origin.y;

    const bounds = map.getBounds();
    const padded = bounds.pad(0.3);
    const topLeft = map.latLngToLayerPoint(padded.getNorthWest());
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(-topLeft.x, -topLeft.y);

    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let rIdx = 0; rIdx < hoveredParcel.normRings.length; rIdx++) {
      const ring = hoveredParcel.normRings[rIdx];
      const len = ring.length;
      if (len < 4) continue;
      ctx.moveTo(ring[0] * scale - originX, ring[1] * scale - originY);
      for (let ptIdx = 2; ptIdx < len; ptIdx += 2) {
        ctx.lineTo(ring[ptIdx] * scale - originX, ring[ptIdx + 1] * scale - originY);
      }
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    ctx.restore();
  }, [map]);

  // Request Animation Frame throttled draw
  const requestDraw = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(() => {
      drawBaseCanvasRef.current();
      animFrameRef.current = null;
    });
  }, []);

  // 4. Stable Leaflet Lifecycle: only mounts/unmounts layer once (NEVER tears down on prop changes)
  useEffect(() => {
    const pane = map.getPanes().overlayPane;
    if (!pane) return;

    const baseCanvas = L.DomUtil.create('canvas', 'leaflet-parcel-base-canvas') as HTMLCanvasElement;
    baseCanvas.style.position = 'absolute';
    baseCanvas.style.pointerEvents = 'none';
    baseCanvas.style.zIndex = '350';

    const interCanvas = L.DomUtil.create('canvas', 'leaflet-parcel-interactive-canvas') as HTMLCanvasElement;
    interCanvas.style.position = 'absolute';
    interCanvas.style.pointerEvents = 'none';
    interCanvas.style.zIndex = '351';

    baseCanvasRef.current = baseCanvas;
    interactiveCanvasRef.current = interCanvas;

    const customLayer = new L.Layer();
    customLayer.onAdd = () => {
      pane.appendChild(baseCanvas);
      pane.appendChild(interCanvas);
      isAttachedRef.current = true;
      requestDraw();
      return customLayer;
    };

    customLayer.onRemove = () => {
      isAttachedRef.current = false;
      if (baseCanvas.parentNode) baseCanvas.parentNode.removeChild(baseCanvas);
      if (interCanvas.parentNode) interCanvas.parentNode.removeChild(interCanvas);
      return customLayer;
    };

    const container = context.layerContainer || map;
    container.addLayer(customLayer);

    const handleMoveStart = () => {
      isInteractingRef.current = true;
    };

    const handleMoveEnd = () => {
      isInteractingRef.current = false;
      requestDraw();
    };

    const handleResize = () => {
      canvasSizeRef.current = { w: 0, h: 0 }; // force re-measure on window resize
      requestDraw();
    };

    map.on('movestart zoomstart', handleMoveStart);
    map.on('moveend zoomend viewreset', handleMoveEnd);
    map.on('resize', handleResize);

    return () => {
      map.off('movestart zoomstart', handleMoveStart);
      map.off('moveend zoomend viewreset', handleMoveEnd);
      map.off('resize', handleResize);

      container.removeLayer(customLayer);
      baseCanvasRef.current = null;
      interactiveCanvasRef.current = null;

      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (mouseRafRef.current !== null) {
        cancelAnimationFrame(mouseRafRef.current);
      }
    };
  }, [context, map, requestDraw]);

  // 5. Redraw when props change without tearing down the layer
  useEffect(() => {
    requestDraw();
  }, [requestDraw, selectedParcelId, scannedBuildingIds, visible, interactionMode, processedData]);

  // 6. Map mousemove with RAF throttling for ultra-fluid 60 FPS hover
  useEffect(() => {
    if (!visible) return;

    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (isInteractingRef.current || !isAttachedRef.current) return;
      mousePosRef.current = e.latlng;

      if (mouseRafRef.current === null) {
        mouseRafRef.current = requestAnimationFrame(() => {
          mouseRafRef.current = null;
          if (!mousePosRef.current || isInteractingRef.current) return;
          const { lat, lng } = mousePosRef.current;
          const hit = findParcelAt(lng, lat, false); // Strict point-in-polygon only
          const hitId = hit ? hit.id : null;

          if (hitId !== hoveredParcelIdRef.current) {
            hoveredParcelIdRef.current = hitId;
            drawHoverHighlight(hit);
            const mapContainer = map.getContainer();
            if (hit) {
              mapContainer.style.cursor = 'pointer';
            } else {
              mapContainer.style.cursor = '';
            }
          }
        });
      }
    };

    const handleMouseOut = () => {
      if (mouseRafRef.current !== null) {
        cancelAnimationFrame(mouseRafRef.current);
        mouseRafRef.current = null;
      }
      if (hoveredParcelIdRef.current !== null) {
        hoveredParcelIdRef.current = null;
        drawHoverHighlight(null);
        map.getContainer().style.cursor = '';
      }
    };

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!isAttachedRef.current) return;
      const { lat, lng } = e.latlng;
      const hit = findParcelAt(lng, lat, true); // Allow tolerance on click
      if (hit) {
        propsRef.current.onSelectParcel(hit.feature);
        const popupHtml = buildPopupHTML(hit);
        L.popup({
          maxWidth: 280,
          minWidth: 230,
          className: 'custom-parcel-popup',
        })
          .setLatLng(e.latlng)
          .setContent(popupHtml)
          .openOn(map);
      }
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);
    map.on('click', handleClick);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      map.off('click', handleClick);
      map.getContainer().style.cursor = '';
    };
  }, [map, visible, findParcelAt, drawHoverHighlight, buildPopupHTML]);

  return null;
};

export default CanvasParcelsLayer;
