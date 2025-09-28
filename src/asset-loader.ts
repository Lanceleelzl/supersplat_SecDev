import { AppBase, Asset, GSplatData, GSplatResource, ContainerResource, Entity, CULLFACE_NONE, Color } from 'playcanvas';

import { Events } from './events';
import { GltfModel } from './gltf-model';
import { Splat } from './splat';

interface ModelLoadRequest {
    filename?: string;
    url?: string;
    contents?: File;
    animationFrame?: boolean;                   // animations disable morton re-ordering at load time for faster loading
    mapUrl?: (name: string) => string;          // function to map texture names to URLs
}

// ideally this function would stream data directly into GSplatData buffers.
// unfortunately the .splat file format has no header specifying total number
// of splats so filesize must be known in order to allocate the correct amount
// of memory.
const deserializeFromSSplat = (data: ArrayBufferLike) => {
    const totalSplats = data.byteLength / 32;
    const dataView = new DataView(data);

    const storage_x = new Float32Array(totalSplats);
    const storage_y = new Float32Array(totalSplats);
    const storage_z = new Float32Array(totalSplats);
    const storage_opacity = new Float32Array(totalSplats);
    const storage_rot_0 = new Float32Array(totalSplats);
    const storage_rot_1 = new Float32Array(totalSplats);
    const storage_rot_2 = new Float32Array(totalSplats);
    const storage_rot_3 = new Float32Array(totalSplats);
    const storage_f_dc_0 = new Float32Array(totalSplats);
    const storage_f_dc_1 = new Float32Array(totalSplats);
    const storage_f_dc_2 = new Float32Array(totalSplats);
    const storage_scale_0 = new Float32Array(totalSplats);
    const storage_scale_1 = new Float32Array(totalSplats);
    const storage_scale_2 = new Float32Array(totalSplats);
    const storage_state = new Uint8Array(totalSplats);


    const SH_C0 = 0.28209479177387814;
    let off;

    for (let i = 0; i < totalSplats; i++) {
        off = i * 32;
        storage_x[i] = dataView.getFloat32(off + 0, true);
        storage_y[i] = dataView.getFloat32(off + 4, true);
        storage_z[i] = dataView.getFloat32(off + 8, true);

        storage_scale_0[i] = Math.log(dataView.getFloat32(off + 12, true));
        storage_scale_1[i] = Math.log(dataView.getFloat32(off + 16, true));
        storage_scale_2[i] = Math.log(dataView.getFloat32(off + 20, true));

        storage_f_dc_0[i] = (dataView.getUint8(off + 24) / 255 - 0.5) / SH_C0;
        storage_f_dc_1[i] = (dataView.getUint8(off + 25) / 255 - 0.5) / SH_C0;
        storage_f_dc_2[i] = (dataView.getUint8(off + 26) / 255 - 0.5) / SH_C0;

        storage_opacity[i] = -Math.log(255 / dataView.getUint8(off + 27) - 1);

        storage_rot_0[i] = (dataView.getUint8(off + 28) - 128) / 128;
        storage_rot_1[i] = (dataView.getUint8(off + 29) - 128) / 128;
        storage_rot_2[i] = (dataView.getUint8(off + 30) - 128) / 128;
        storage_rot_3[i] = (dataView.getUint8(off + 31) - 128) / 128;
    }

    return new GSplatData([{
        name: 'vertex',
        count: totalSplats,
        properties: [
            { type: 'float', name: 'x', storage: storage_x, byteSize: 4 },
            { type: 'float', name: 'y', storage: storage_y, byteSize: 4 },
            { type: 'float', name: 'z', storage: storage_z, byteSize: 4 },
            { type: 'float', name: 'opacity', storage: storage_opacity, byteSize: 4 },
            { type: 'float', name: 'rot_0', storage: storage_rot_0, byteSize: 4 },
            { type: 'float', name: 'rot_1', storage: storage_rot_1, byteSize: 4 },
            { type: 'float', name: 'rot_2', storage: storage_rot_2, byteSize: 4 },
            { type: 'float', name: 'rot_3', storage: storage_rot_3, byteSize: 4 },
            { type: 'float', name: 'f_dc_0', storage: storage_f_dc_0, byteSize: 4 },
            { type: 'float', name: 'f_dc_1', storage: storage_f_dc_1, byteSize: 4 },
            { type: 'float', name: 'f_dc_2', storage: storage_f_dc_2, byteSize: 4 },
            { type: 'float', name: 'scale_0', storage: storage_scale_0, byteSize: 4 },
            { type: 'float', name: 'scale_1', storage: storage_scale_1, byteSize: 4 },
            { type: 'float', name: 'scale_2', storage: storage_scale_2, byteSize: 4 },
            { type: 'float', name: 'state', storage: storage_state, byteSize: 4 }
        ]
    }]);
};

let assetId = 0;

// handles loading gltf container assets
class AssetLoader {
    app: AppBase;
    events: Events;
    defaultAnisotropy: number;
    loadAllData = true;

    constructor(app: AppBase, events: Events, defaultAnisotropy?: number) {
        this.app = app;
        this.events = events;
        this.defaultAnisotropy = defaultAnisotropy || 1;
    }

    loadPly(loadRequest: ModelLoadRequest) {
        if (!loadRequest.animationFrame) {
            this.events.fire('startSpinner');
        }

        let file;

        const isSog = loadRequest.filename.toLowerCase().endsWith('.sog');
        if (isSog) {
            // sog expects contents to be an arrayBuffer
            file = {
                url: URL.createObjectURL(loadRequest.contents),
                filename: loadRequest.filename
            };
        } else {
            const contents = loadRequest.contents && (loadRequest.contents instanceof Response ? loadRequest.contents : new Response(loadRequest.contents));
            file = {
                // we must construct a unique url if contents is provided
                url: contents ? `local-asset-${assetId++}` : loadRequest.url ?? loadRequest.filename,
                filename: loadRequest.filename,
                contents
            };
        }

        const data = {
            // decompress data on load
            decompress: true,
            // disable morton re-ordering when loading animation frames
            reorder: !(loadRequest.animationFrame ?? false),
            mapUrl: loadRequest.mapUrl
        };

        const options = {
            mapUrl: loadRequest.mapUrl
        };

        return new Promise<Splat>((resolve, reject) => {
            const asset = new Asset(
                loadRequest.filename || loadRequest.url,
                'gsplat',
                // @ts-ignore
                file,
                data,
                options
            );

            asset.on('load:data', (data: GSplatData) => {
                // support loading 2d splats by adding scale_2 property with almost 0 scale
                if (data instanceof GSplatData && data.getProp('scale_0') && data.getProp('scale_1') && !data.getProp('scale_2')) {
                    const scale2 = new Float32Array(data.numSplats).fill(Math.log(1e-6));
                    data.addProp('scale_2', scale2);

                    // place the new scale_2 property just after scale_1
                    const props = data.getElement('vertex').properties;
                    props.splice(props.findIndex((prop: any) => prop.name === 'scale_1') + 1, 0, props.splice(props.length - 1, 1)[0]);
                }
            });

            asset.on('load', () => {
                // check the PLY contains minimal set of we expect
                const required = [
                    'x', 'y', 'z',
                    'scale_0', 'scale_1', 'scale_2',
                    'rot_0', 'rot_1', 'rot_2', 'rot_3',
                    'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'
                ];
                const splatData = (asset.resource as GSplatResource).gsplatData as GSplatData;
                const missing = required.filter(x => !splatData.getProp(x));
                if (missing.length > 0) {
                    reject(new Error(`This file does not contain gaussian splatting data. The following properties are missing: ${missing.join(', ')}`));
                } else {
                    resolve(new Splat(asset));
                }
            });

            asset.on('error', (err: string) => {
                reject(err);
            });

            this.app.assets.add(asset);
            this.app.assets.load(asset);
        }).finally(() => {
            if (!loadRequest.animationFrame) {
                this.events.fire('stopSpinner');
            }
        });
    }

    async loadSplat(loadRequest: ModelLoadRequest) {
        this.events.fire('startSpinner');

        try {
            const contents = loadRequest.contents && (loadRequest.contents instanceof Response ? loadRequest.contents : new Response(loadRequest.contents));
            const response = await (contents ?? fetch(loadRequest.url || loadRequest.filename)) as Response;

            if (!response || !response.ok || !response.body) {
                throw new Error('Failed to fetch splat data');
            }

            const arrayBuffer = await response.arrayBuffer();

            const gsplatData = deserializeFromSSplat(arrayBuffer);

            const asset = new Asset(loadRequest.filename || loadRequest.url, 'gsplat', {
                url: loadRequest.url,
                filename: loadRequest.filename
            });
            this.app.assets.add(asset);
            asset.resource = new GSplatResource(this.app.graphicsDevice, gsplatData);

            return new Splat(asset);
        } finally {
            this.events.fire('stopSpinner');
        }
    }

    loadGltf(loadRequest: ModelLoadRequest) {
        this.events.fire('startSpinner');

        return new Promise<GltfModel>((resolve, reject) => {
            const asset = new Asset(loadRequest.filename || loadRequest.url, 'container', {
                url: loadRequest.url,
                filename: loadRequest.filename
            });

            if (loadRequest.contents) {
                // Create blob URL for the file contents
                const blob = new Blob([loadRequest.contents], {
                    type: loadRequest.filename?.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json'
                });
                asset.file = {
                    url: URL.createObjectURL(blob),
                    filename: loadRequest.filename || 'model.gltf'
                };
            }

            asset.on('load', () => {
                try {
                    // Create an entity to hold the glTF model
                    const containerResource = asset.resource as ContainerResource;
                    const entity = containerResource.instantiateRenderEntity();
                    entity.name = loadRequest.filename || loadRequest.url || 'glTF Model';

                    // Add to the scene root
                    this.app.root.addChild(entity);

                    // Add basic lighting if not present
                    this.ensureBasicLighting();

                    // Configure lighting for the model
                    this.configureMaterialsForLighting(entity);

                    const gltfModel = new GltfModel(asset, entity);
                    // 若当前还没有加入 scene.elements，需要显式加入
                    // 加入 Scene.elements 的职责应在外层统一处理；这里通过事件让主场景监听添加
                    // 外层（例如 main / editor 初始化）可监听 'model.loaded.gltf' 并调用 scene.add(gltfModel)
                    // Initialize physics picking collider (non-fatal if unavailable)
                    try {
                        (gltfModel as any).setupPhysicsPicking?.();
                    } catch (e) {
                        console.warn('Physics picking setup failed (non-fatal):', e);
                    }

                    // Auto-focus camera on the newly loaded model
                    const bound = gltfModel.worldBound;
                    if (bound) {
                        // Add event listener for when the model is added to scene
                        this.events.once('scene.elementAdded', (element: any) => {
                            if (element === gltfModel) {
                                // Get scene from the element
                                const scene = element.scene;
                                if (scene && scene.camera) {
                                    scene.camera.focus({
                                        focalPoint: bound.center,
                                        radius: bound.halfExtents.length(),
                                        speed: 1
                                    });
                                }
                            }
                        });
                    }

                    // 通过事件通知外部逻辑将该元素加入 Scene（若外层未自动处理）
                    try {
                        this.events.fire('model.loaded.gltf', gltfModel);
                    } catch { /* ignore */ }
                    resolve(gltfModel);
                } catch (error) {
                    reject(new Error(`Failed to instantiate glTF model: ${error.message}`));
                }
            });

            asset.on('error', (err: string) => {
                reject(new Error(`Failed to load glTF model: ${err}`));
            });

            this.app.assets.add(asset);
            this.app.assets.load(asset);
        }).finally(() => {
            if (!loadRequest.animationFrame) {
                this.events.fire('stopSpinner');
            }
        });
    }

    loadModel(loadRequest: ModelLoadRequest) {
        const filename = (loadRequest.filename || loadRequest.url).toLowerCase();

        if (filename.endsWith('.splat')) {
            return this.loadSplat(loadRequest);
        } else if (filename.endsWith('.gltf') || filename.endsWith('.glb')) {
            return this.loadGltf(loadRequest);
        }
        return this.loadPly(loadRequest);
    }

    private ensureBasicLighting() {
        // Check if there's already lighting
        const existingLights = this.app.root.findComponents('light');
        const hasLight = existingLights.length > 0;

        if (!hasLight) {
            // Create a single directional light
            const mainLight = new Entity('DirectionalLight');
            mainLight.addComponent('light', {
                type: 'directional',
                color: [1, 1, 1],
                intensity: 1.0,
                castShadows: false
            });
            mainLight.setPosition(10, 10, 10);
            mainLight.lookAt(0, 0, 0);
            this.app.root.addChild(mainLight);

            // Set scene ambient light for overall illumination
            this.app.scene.ambientLight = new Color(0.4, 0.4, 0.4);
        }
    }

    private configureMaterialsForLighting(entity: any) {
        // Find all render components and configure their materials
        const renderComponents = entity.findComponents('render');
        renderComponents.forEach((render: any) => {
            if (render.meshInstances) {
                render.meshInstances.forEach((meshInstance: any) => {
                    const material = meshInstance.material;
                    if (material) {
                        // Ensure materials can receive lighting
                        if (material.unlit === undefined) {
                            material.unlit = false;
                        }

                        // Enable double-sided rendering to fix black backfaces
                        material.twoSidedLighting = true;
                        material.cull = CULLFACE_NONE; // Disable backface culling

                        // Ensure proper lighting model
                        if (material.shadingModel === undefined) {
                            material.shadingModel = 1; // SPECULARGLOSINESS
                        }

                        // Add some ambient lighting if the material is too dark
                        if (!material.ambient) {
                            material.ambient = [0.2, 0.2, 0.2];
                        }

                        material.update();
                    }
                });
            }
        });
    }
}

export { AssetLoader };
