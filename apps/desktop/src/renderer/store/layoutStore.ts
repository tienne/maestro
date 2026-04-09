import { create } from 'zustand';
import type { MosaicNode } from 'react-mosaic-component';

export type PaneId = string;

interface LayoutState {
  mosaicState: MosaicNode<PaneId> | null;
  setMosaicState: (state: MosaicNode<PaneId> | null) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mosaicState: null,
  setMosaicState: (state) => set({ mosaicState: state }),
}));
