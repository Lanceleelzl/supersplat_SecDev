import { Element, ElementType } from './element';
import { Events } from './events';
import { GltfModel } from './gltf-model';
import { Scene } from './scene';
import { Splat } from './splat';

const registerSelectionEvents = (events: Events, scene: Scene) => {
    let selection: Element = null;

    const setSelection = (element: Element, fromUserInteraction = false) => {
        console.log('🚀 DEBUG: setSelection called', {
            element: element?.type,
            filename: element?.type === ElementType.model ? (element as GltfModel).filename : (element as any)?.filename,
            fromUserInteraction: fromUserInteraction
        });
        
        // Check if element is visible (for both Splats and GltfModels)
        let isVisible = true;
        if (element?.type === ElementType.splat) {
            isVisible = (element as Splat).visible;
        } else if (element?.type === ElementType.model) {
            isVisible = (element as GltfModel).entity?.enabled !== false;
        }

        console.log('🔍 DEBUG: Visibility check', {
            isVisible: isVisible,
            elementNotSelection: element !== selection,
            shouldProceed: element !== selection && (!element || isVisible)
        });

        if (element !== selection && (!element || isVisible)) {
            const prev = selection;
            selection = element;
            events.fire('selection.changed', selection, prev);
            
            // Show info popup for GLB models ONLY when user clicks (not on auto-selection)
            if (element && element.type === ElementType.model && fromUserInteraction) {
                const model = element as GltfModel;
                console.log('🔥 DEBUG: About to show popup for GLB model', {
                    filename: model.filename,
                    visible: model.visible,
                    fromUserInteraction: fromUserInteraction
                });
                
                events.invoke('showPopup', {
                    type: 'info',
                    header: 'Model Selected',
                    message: `Selected model: ${model.filename || 'Unknown'}\nType: GLB/glTF Model\nVisible: ${model.visible ? 'Yes' : 'No'}`
                });
                
                console.log('🔥 DEBUG: showPopup event invoked');
            } else {
                console.log('🚨 DEBUG: Popup conditions not met', {
                    hasElement: !!element,
                    elementType: element?.type,
                    isModelType: element?.type === ElementType.model,
                    fromUserInteraction: fromUserInteraction
                });
            }
        }
    };

    events.on('selection', (element: Element) => {
        setSelection(element);
    });

    events.function('selection', () => {
        return selection;
    });

    events.on('selection.next', () => {
        const elements = [
            ...scene.getElementsByType(ElementType.splat),
            ...scene.getElementsByType(ElementType.model)
        ];
        if (elements.length > 1) {
            const idx = elements.indexOf(selection);
            setSelection(elements[(idx + 1) % elements.length]);
        }
    });

    events.on('scene.elementAdded', (element: Element) => {
        if (element.type === ElementType.splat || element.type === ElementType.model) {
            setSelection(element);
        }
    });

    events.on('scene.elementRemoved', (element: Element) => {
        if (element === selection) {
            const elements = [
                ...scene.getElementsByType(ElementType.splat),
                ...scene.getElementsByType(ElementType.model)
            ];
            setSelection(elements.length === 1 ? null : elements.find(v => v !== element));
        }
    });

    events.on('splat.visibility', (splat: Splat) => {
        if (splat === selection && !splat.visible) {
            setSelection(null);
        }
    });

    events.on('model.visibility', (model: GltfModel) => {
        if (model === selection && !model.entity?.enabled) {
            setSelection(null);
        }
    });

    events.on('camera.focalPointPicked', (details: { splat?: Splat, model?: GltfModel }) => {
        console.log('🎯 DEBUG: Camera focal point picked', details);
        if (details.splat) {
            console.log('🔸 DEBUG: Selecting splat:', details.splat.filename);
            setSelection(details.splat, true); // true indicates user interaction
        } else if (details.model) {
            console.log('🔸 DEBUG: Selecting GLB model:', details.model.filename);
            setSelection(details.model, true); // true indicates user interaction
        }
    });
};

export { registerSelectionEvents };
