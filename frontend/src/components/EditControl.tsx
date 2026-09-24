import { useEffect, useRef } from 'react';
import { useLeafletContext } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet-draw';

export interface EditControlProps {
  position?: L.ControlPosition;
  draw?: any;
  edit?: any;
  onCreated?: (e: any) => void;
  onEdited?: (e: any) => void;
  onDeleted?: (e: any) => void;
  onMounted?: (drawControl: L.Control.Draw) => void;
}

export const EditControl = ({
  position = 'topright',
  draw,
  edit,
  onCreated,
  onEdited,
  onDeleted,
  onMounted,
}: EditControlProps) => {
  const context = useLeafletContext();
  const onCreatedRef = useRef(onCreated);
  const onEditedRef = useRef(onEdited);
  const onDeletedRef = useRef(onDeleted);
  const drawRef = useRef(draw);
  const editRef = useRef(edit);

  useEffect(() => {
    onCreatedRef.current = onCreated;
    onEditedRef.current = onEdited;
    onDeletedRef.current = onDeleted;
    drawRef.current = draw;
    editRef.current = edit;
  });

  useEffect(() => {
    const { map, layerContainer } = context;
    const featureGroup = (layerContainer as L.FeatureGroup) || new L.FeatureGroup();
    if (!layerContainer) {
      map.addLayer(featureGroup);
    }

    // Leaflet Draw expects object options for shapes when enabled
    const drawConfig: any = { ...drawRef.current };
    if (drawConfig.rectangle === true) {
      drawConfig.rectangle = {};
    }

    const drawControl = new L.Control.Draw({
      position,
      edit: {
        featureGroup,
        remove: true,
        ...editRef.current,
      },
      draw: drawConfig,
    });

    map.addControl(drawControl);

    if (onMounted) {
      onMounted(drawControl);
    }

    const handleCreated = (e: any) => {
      onCreatedRef.current?.(e);
    };

    const handleEdited = (e: any) => {
      onEditedRef.current?.(e);
    };

    const handleDeleted = (e: any) => {
      onDeletedRef.current?.(e);
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.removeControl(drawControl);
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
    };
  }, [context, position, onMounted]);

  return null;
};
