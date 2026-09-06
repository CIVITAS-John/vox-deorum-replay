/**
 * layers-control.ts
 * The map's layer picker
 * A button on the map opens a dropdown panel with one checkbox per
 * toggleable layer. Checking a box adds the layer to the map, unchecking
 * removes it. Replaces Leaflet's built-in layers control so the picker
 * matches the rest of the interface.
 */

import { MapLayer } from '../map/types';

// One row in the panel: the layer and its label
export interface ToggleableLayer {
	label: string;
	layer: MapLayer;
}

/**
 * LayersControl class
 * Builds and drives the layer checkbox panel
 */
export class LayersControl {
	private map: any;                            // Leaflet map the layers sit on
	private layers: ToggleableLayer[];           // Layers offered by the panel
	private panel: HTMLElement;                  // The checkbox panel element
	private details: HTMLDetailsElement;         // The wrapping details element
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null; // Closes the panel

	constructor(map: any, layers: ToggleableLayer[]) {
		this.map = map;
		this.layers = layers;
		this.panel = document.getElementById('layersPanel');
		this.details = document.getElementById('layersControl') as HTMLDetailsElement;

		this.buildPanel();

		// Close the panel when clicking anywhere outside it
		this.outsideClickHandler = (e: MouseEvent) => {
			if (this.details.open && !this.details.contains(e.target as Node)) {
				this.details.open = false;
			}
		};
		document.addEventListener('click', this.outsideClickHandler);
	}

	/**
	 * Build one checkbox row per layer into the panel
	 */
	private buildPanel(): void {
		this.layers.forEach(entry => {
			const label = document.createElement('label');
			label.className = 'layer-option';

			// Layers start on the map, so their boxes start checked
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = entry.layer._map !== undefined && entry.layer._map !== null;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					entry.layer.addTo(this.map);
				} else {
					this.map.removeLayer(entry.layer);
				}
			});

			const text = document.createElement('span');
			text.textContent = entry.label;

			label.appendChild(checkbox);
			label.appendChild(text);
			this.panel.appendChild(label);
		});
	}

	/**
	 * Tear the control down when its session is discarded
	 */
	destroy(): void {
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		this.panel.innerHTML = '';
		this.details.open = false;
	}
}
