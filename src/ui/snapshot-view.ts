import { Entity, Vec3, Color, LAYERID_UI, Texture, RenderTarget, PIXELFORMAT_RGBA8, PIXELFORMAT_DEPTH, ADDRESS_CLAMP_TO_EDGE, FILTER_NEAREST, WebglGraphicsDevice } from 'playcanvas';
import { Container, Element } from '@playcanvas/pcui';
import { Events } from '../events';
import { Scene } from '../scene';
import { Camera } from '../camera';
import closeSvg from './svg/close_01.svg';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class SnapshotView extends Container {
    canvas: HTMLCanvasElement;
    camera: any; // 改为简化的相机对象，不使用 Camera 类
    scene: Scene;
    events: Events;
    currentMarker: any = null;
    isDragging = false;
    dragOffset = { x: 0, y: 0 };
    isActive = false;
    cameraControlsPanel: HTMLElement;
    private cameraParamsManager: any = null; // 相机参数管理器
    private renderingActive = false; // 渲染状态标志

    constructor(events: Events, scene: Scene, args = {}) {
        super({
            id: 'snapshot-panel',
            class: 'snapshot-view',
            ...args
        });

        this.events = events;
        this.scene = scene;
        
        // 初始化相机参数管理器
        this.cameraParamsManager = this.createCameraParamsManager();
        
        // stop pointer events bubbling - 阻止指针事件冒泡
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });
        
        this.createUI();
        this.setupEventListeners();
        this.createCameraControls();
        this.addDragFunctionality();
        
        // 添加clickable类
        this.dom.classList.add('clickable');
        
        // 初始隐藏
        this.hidden = true;
        
        // 不在构造函数中创建相机，改为懒加载模式
        // 相机将在第一次调用render方法时创建
        
        // 添加到body
        document.body.appendChild(this.dom);
    }

    private createUI() {
        // 创建标题栏
        const titlebar = document.createElement('div');
        titlebar.className = 'snapshot-titlebar';
        
        const title = document.createElement('h3');
        title.className = 'snapshot-title';
        title.textContent = '相机预览';
        
        const closeBtn = new Element({
            class: 'snapshot-close'
        });
        closeBtn.dom.appendChild(createSvg(closeSvg));
        closeBtn.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closePanel();
        });
        
        titlebar.appendChild(title);
        titlebar.appendChild(closeBtn.dom);
        
        // 创建视口
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'snapshot-viewport';
        this.canvas.width = 320;
        this.canvas.height = 180;
        
        this.dom.appendChild(titlebar);
        this.dom.appendChild(this.canvas);
    }

    private createVirtualCamera() {
        // 检查scene.app是否已经初始化
        if (!this.scene.app || !this.scene.app.root) {
            console.warn('Scene app not initialized yet, retrying in 100ms');
            setTimeout(() => {
                this.createVirtualCamera();
            }, 100);
            return;
        }
        
        // 创建完全独立的相机系统
        this.camera = this.createIndependentCamera();
        
        // 创建独立的渲染目标
        this.setupIndependentRenderTarget();
    }

    /**
     * 创建完全独立的相机系统
     * 该相机不会影响主场景的编辑器相机
     */
    private createIndependentCamera() {
        // 创建完全独立的相机实体，不添加到场景层级中
        const entity = new Entity('independentSnapshotCamera');
        entity.addComponent('camera', {
            clearColorBuffer: true,
            clearDepthBuffer: true,
            clearColor: new Color(0.1, 0.1, 0.1, 1.0),
            nearClip: 0.1,
            farClip: 1000,
            fov: 45,
            projection: 0, // PROJECTION_PERSPECTIVE
            priority: 0,
            enabled: false // 默认禁用
        });
        
        // 创建渲染目标
        this.setupRenderTarget(entity);
        
        // 创建相机包装器，提供便捷的操作接口
        const camera = {
            entity: entity,
            _position: new Vec3(0, 0, 5),
            _rotation: new Vec3(0, 0, 0),
            _target: new Vec3(0, 0, 0),
            
            // 位置和旋转控制
            setPosition: (x: number, y: number, z: number) => {
                camera._position.set(x, y, z);
                entity.setPosition(x, y, z);
            },
            getPosition: () => {
                return entity.getPosition().clone();
            },
            setRotation: (x: number, y: number, z: number) => {
                camera._rotation.set(x, y, z);
                entity.setEulerAngles(x, y, z);
            },
            lookAt: (target: Vec3) => {
                entity.lookAt(target);
                // 更新内部旋转记录
                const eulerAngles = entity.getEulerAngles();
                camera._rotation.copy(eulerAngles);
            },
            
            // 渲染控制方法
            activateForRender: () => {
                // 临时添加到场景中进行渲染
                if (!entity.parent) {
                    this.scene.app.root.addChild(entity);
                }
                entity.camera.enabled = true;
                entity.enabled = true;
            },
            
            // 渲染后立即移除
            deactivateAfterRender: () => {
                entity.camera.enabled = false;
                entity.enabled = false;
                if (entity.parent) {
                    entity.parent.removeChild(entity);
                }
            }
        };
        
        // 配置独立相机的默认参数
        this.configureIndependentCameraDefaults(camera);
        
        // 设置独立的渲染层级
        this.setupIndependentCameraLayers(camera);
        
        return camera;
    }

    /**
     * 设置渲染目标
     */
    private setupRenderTarget(entity: Entity) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // 创建纹理
        const createTexture = (name: string, width: number, height: number, format: number) => {
            return new Texture(this.scene.graphicsDevice, {
                name: name,
                width: width,
                height: height,
                format: format,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        };

        // 创建渲染目标
        const colorBuffer = createTexture('snapshotColor', width, height, PIXELFORMAT_RGBA8);
        const depthBuffer = createTexture('snapshotDepth', width, height, PIXELFORMAT_DEPTH);
        
        const renderTarget = new RenderTarget({
            colorBuffer,
            depthBuffer,
            flipY: false,
            autoResolve: false
        });
        
        entity.camera.renderTarget = renderTarget;
        entity.camera.horizontalFov = width > height;
    }

    /**
     * 配置独立相机的默认参数
     */
    private configureIndependentCameraDefaults(camera: any) {
        const cameraComponent = camera.entity.camera;
        
        // 基础渲染参数
        cameraComponent.clearColor = new Color(0.1, 0.1, 0.1, 1);
        cameraComponent.fov = 75;
        cameraComponent.nearClip = 0.1;
        cameraComponent.farClip = 1000;
        
        // 高级相机参数（如果支持）
        if (cameraComponent.aperture !== undefined) {
            cameraComponent.aperture = 16;
        }
        if (cameraComponent.sensitivity !== undefined) {
            cameraComponent.sensitivity = 1000;
        }
        if (cameraComponent.shutter !== undefined) {
            cameraComponent.shutter = 60;
        }
        if (cameraComponent.toneMapping !== undefined) {
            cameraComponent.toneMapping = 0;
        }
        
        // 渲染控制参数
        cameraComponent.clearColorBuffer = true;
        cameraComponent.clearDepthBuffer = true;
        cameraComponent.frustumCulling = true;
    }

    /**
     * 设置独立相机的渲染层级
     */
    private setupIndependentCameraLayers(camera: any) {
        // 获取主场景的所有可见层级
        const mainCameraLayers = this.scene.camera.entity.camera.layers || [];
        
        // 复制主相机的层级设置，但保持独立
        camera.entity.camera.layers = [...mainCameraLayers];
    }

    /**
     * 设置独立的渲染目标
     */
    private setupIndependentRenderTarget() {
        // 创建独立的渲染目标
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        const colorBuffer = new Texture(this.scene.graphicsDevice, {
            width: width,
            height: height,
            format: PIXELFORMAT_RGBA8,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            magFilter: FILTER_NEAREST,
            minFilter: FILTER_NEAREST
        });
        
        const renderTarget = new RenderTarget({
            colorBuffer: colorBuffer,
            depth: false,
            autoResolve: false
        });
        
        this.camera.entity.camera.renderTarget = renderTarget;
    }

    /**
     * 同步相机参数到标记点位
     */
    private syncCameraWithMarkerParams() {
        if (!this.currentMarker || !this.camera) return;
        
        // 从相机参数管理器获取当前标记的参数
        const params = this.cameraParamsManager.getParams(this.currentMarker.id);
        if (!params) return;
        
        // 设置相机位置和旋转
        this.camera.setPosition(params.position.x, params.position.y, params.position.z);
        this.camera.setRotation(params.rotation.x, params.rotation.y, params.rotation.z);
        
        // 如果有目标点，使用lookAt
        if (params.target) {
            this.camera.lookAt(new Vec3(params.target.x, params.target.y, params.target.z));
        }
    }

    /**
     * 激活独立相机进行渲染
     */
    private activateIndependentCamera() {
        if (!this.camera) {
            this.camera = this.createIndependentCamera();
        }
        
        // 同步相机参数
        this.syncCameraWithMarkerParams();
        
        // 激活相机
        this.camera.activateForRender();
    }

    /**
     * 停用独立相机
     */
    private deactivateIndependentCamera() {
        if (this.camera && this.camera.deactivateAfterRender) {
            this.camera.deactivateAfterRender();
        }
    }

    private createCameraControls() {
        this.cameraControlsPanel = document.createElement('div');
        this.cameraControlsPanel.className = 'camera-controls';
        
        const controlsHTML = `
            <div class="camera-controls-header">
                <span>相机参数控制</span>
                <div class="camera-actions">
                    <button id="copy-main-camera" title="复制主相机参数">复制主相机</button>
                    <button id="save-params" title="保存参数到巡检点位">保存参数</button>
                    <button id="reset-params" title="重置为默认参数">重置</button>
                </div>
            </div>
            <style>
                .camera-controls-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #444;
                }
                
                .camera-actions {
                    display: flex;
                    gap: 5px;
                }
                
                .camera-actions button {
                    padding: 4px 8px;
                    font-size: 11px;
                    background: #555;
                    color: white;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                }
                
                .camera-actions button:hover {
                    background: #666;
                }
                
                .camera-actions button:active {
                    background: #777;
                }
            </style>
            <div class="control-group">
                <label class="control-label">FOV (视野角度)</label>
                <input type="range" class="control-input" id="fov-slider" min="10" max="120" value="75">
            </div>
            <div class="control-group">
                <div class="control-row">
                    <div>
                        <label class="control-label">Near Clip</label>
                        <input type="number" class="control-input" id="near-clip" value="0.1" step="0.1" min="0.01">
                    </div>
                    <div>
                        <label class="control-label">Far Clip</label>
                        <input type="number" class="control-input" id="far-clip" value="1000" step="10" min="1">
                    </div>
                </div>
            </div>
            <div class="control-group">
                <div class="control-row">
                    <div>
                        <label class="control-label">Aperture</label>
                        <input type="number" class="control-input" id="aperture" value="16" step="0.1" min="1" max="32">
                    </div>
                    <div>
                        <label class="control-label">Sensitivity</label>
                        <input type="number" class="control-input" id="sensitivity" value="1000" step="50" min="100" max="6400">
                    </div>
                </div>
            </div>
            <div class="control-group">
                <div class="control-row">
                    <div>
                        <label class="control-label">Shutter</label>
                        <input type="number" class="control-input" id="shutter" value="60" step="1" min="1" max="1000">
                    </div>
                    <div>
                        <label class="control-label">Tone Mapping</label>
                        <select class="control-input" id="tone-mapping">
                            <option value="0">Linear</option>
                            <option value="1">Filmic</option>
                            <option value="2">Hejl</option>
                            <option value="3">ACES</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
        
        this.cameraControlsPanel.innerHTML = controlsHTML;
        this.dom.appendChild(this.cameraControlsPanel);
        
        // 为相机控制面板添加事件阻止，防止穿透到主场景
        this.setupCameraControlsEventBlocking();
        
        // 绑定控制事件
        this.setupCameraControlEvents();
        
        // 设置参数管理按钮事件监听器
        this.setupParamsManagerEvents();
    }

    private setupCameraControlsEventBlocking() {
        // 阻止相机控制面板的所有事件穿透
        const eventTypes = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove'];
        
        eventTypes.forEach(eventType => {
            this.cameraControlsPanel.addEventListener(eventType, (event) => {
                event.stopPropagation();
                if (eventType === 'wheel' || eventType === 'contextmenu') {
                    event.preventDefault();
                }
            }, true);
        });
        
        // 为所有输入控件添加额外的事件阻止
        const inputs = this.cameraControlsPanel.querySelectorAll('input, select, button');
        inputs.forEach(input => {
            eventTypes.forEach(eventType => {
                input.addEventListener(eventType, (event) => {
                    event.stopPropagation();
                }, true);
            });
        });
    }

    // 设置参数管理按钮事件监听器
    private setupParamsManagerEvents() {
        if (!this.cameraControlsPanel) return;
        
        // 复制主相机参数按钮
        const copyMainCameraBtn = this.cameraControlsPanel.querySelector('#copy-main-camera') as HTMLButtonElement;
        if (copyMainCameraBtn) {
            copyMainCameraBtn.addEventListener('click', () => {
                this.cameraParamsManager.copyFromMainCamera();
                this.updateControlsFromCamera(); // 更新UI显示
            });
        }
        
        // 保存参数按钮
        const saveParamsBtn = this.cameraControlsPanel.querySelector('#save-params') as HTMLButtonElement;
        if (saveParamsBtn) {
            saveParamsBtn.addEventListener('click', () => {
                if (this.currentMarker) {
                    this.cameraParamsManager.saveToMarker(this.currentMarker);
                } else {
                    console.warn('没有选中的巡检点位，无法保存参数');
                }
            });
        }
        
        // 重置参数按钮
        const resetParamsBtn = this.cameraControlsPanel.querySelector('#reset-params') as HTMLButtonElement;
        if (resetParamsBtn) {
            resetParamsBtn.addEventListener('click', () => {
                this.cameraParamsManager.resetToDefaults();
                this.updateControlsFromCamera(); // 更新UI显示
            });
        }
    }
    
    // 从相机更新控制面板显示
    private updateControlsFromCamera() {
        if (!this.camera?.entity?.camera || !this.cameraControlsPanel) return;
        
        const camera = this.camera.entity.camera;
        
        // 更新各个控制项的值
        const fovSlider = this.cameraControlsPanel.querySelector('#fov-slider') as HTMLInputElement;
        const nearClip = this.cameraControlsPanel.querySelector('#near-clip') as HTMLInputElement;
        const farClip = this.cameraControlsPanel.querySelector('#far-clip') as HTMLInputElement;
        const aperture = this.cameraControlsPanel.querySelector('#aperture') as HTMLInputElement;
        const sensitivity = this.cameraControlsPanel.querySelector('#sensitivity') as HTMLInputElement;
        const shutter = this.cameraControlsPanel.querySelector('#shutter') as HTMLInputElement;
        const toneMapping = this.cameraControlsPanel.querySelector('#tone-mapping') as HTMLSelectElement;
        
        if (fovSlider) fovSlider.value = camera.fov.toString();
        if (nearClip) nearClip.value = camera.nearClip.toString();
        if (farClip) farClip.value = camera.farClip.toString();
        if (aperture) aperture.value = (camera.aperture || 16).toString();
        if (sensitivity) sensitivity.value = (camera.sensitivity || 1000).toString();
        if (shutter) shutter.value = (camera.shutter || 60).toString();
        if (toneMapping) toneMapping.value = (camera.toneMapping || 0).toString();
    }

    private setupCameraControlEvents() {
        const fovSlider = this.cameraControlsPanel.querySelector('#fov-slider') as HTMLInputElement;
        const nearClip = this.cameraControlsPanel.querySelector('#near-clip') as HTMLInputElement;
        const farClip = this.cameraControlsPanel.querySelector('#far-clip') as HTMLInputElement;
        const aperture = this.cameraControlsPanel.querySelector('#aperture') as HTMLInputElement;
        const sensitivity = this.cameraControlsPanel.querySelector('#sensitivity') as HTMLInputElement;
        const shutter = this.cameraControlsPanel.querySelector('#shutter') as HTMLInputElement;
        const toneMapping = this.cameraControlsPanel.querySelector('#tone-mapping') as HTMLSelectElement;

        // FOV控制
        fovSlider.addEventListener('input', () => {
            const fov = parseFloat(fovSlider.value);
            this.camera.entity.camera.fov = fov;
            this.updateMarkerCameraParams({ fov });
        });

        // Near/Far Clip控制
        nearClip.addEventListener('change', () => {
            const near = parseFloat(nearClip.value);
            this.camera.entity.camera.nearClip = near;
            this.updateMarkerCameraParams({ nearClip: near });
        });

        farClip.addEventListener('change', () => {
            const far = parseFloat(farClip.value);
            this.camera.entity.camera.farClip = far;
            this.updateMarkerCameraParams({ farClip: far });
        });

        // 相机参数控制
        aperture.addEventListener('change', () => {
            const value = parseFloat(aperture.value);
            if (this.camera.entity.camera.aperture !== undefined) {
                this.camera.entity.camera.aperture = value;
            }
            this.updateMarkerCameraParams({ aperture: value });
        });

        sensitivity.addEventListener('change', () => {
            const value = parseFloat(sensitivity.value);
            if (this.camera.entity.camera.sensitivity !== undefined) {
                this.camera.entity.camera.sensitivity = value;
            }
            this.updateMarkerCameraParams({ sensitivity: value });
        });

        shutter.addEventListener('change', () => {
            const value = parseFloat(shutter.value);
            if (this.camera.entity.camera.shutter !== undefined) {
                this.camera.entity.camera.shutter = value;
            }
            this.updateMarkerCameraParams({ shutter: value });
        });

        toneMapping.addEventListener('change', () => {
            const value = parseInt(toneMapping.value);
            if (this.camera.entity.camera.toneMapping !== undefined) {
                this.camera.entity.camera.toneMapping = value;
            }
            this.updateMarkerCameraParams({ toneMapping: value });
        });
    }

    // 更新相机参数到巡检点位（保持向后兼容）
    private updateMarkerCameraParams(params: any) {
        if (!this.currentMarker) return;
        
        // 使用相机参数管理器保存参数
        this.cameraParamsManager.saveToMarker(this.currentMarker);
    }

    /**
     * 同步更新独立相机的参数
     * 只更新独立相机，不影响主场景相机
     */
    private syncIndependentCameraParams(params: any) {
        if (!this.camera) return;
        
        const cameraComponent = this.camera.entity.camera;
        
        // 更新基础参数
        if (params.fov !== undefined) {
            cameraComponent.fov = params.fov;
        }
        if (params.nearClip !== undefined) {
            cameraComponent.nearClip = params.nearClip;
        }
        if (params.farClip !== undefined) {
            cameraComponent.farClip = params.farClip;
        }
        
        // 更新高级参数（如果支持）
        if (params.aperture !== undefined && cameraComponent.aperture !== undefined) {
            cameraComponent.aperture = params.aperture;
        }
        if (params.sensitivity !== undefined && cameraComponent.sensitivity !== undefined) {
            cameraComponent.sensitivity = params.sensitivity;
        }
        if (params.shutter !== undefined && cameraComponent.shutter !== undefined) {
            cameraComponent.shutter = params.shutter;
        }
        if (params.toneMapping !== undefined && cameraComponent.toneMapping !== undefined) {
            cameraComponent.toneMapping = params.toneMapping;
        }
        
        // 更新位置和目标
        if (params.position) {
            this.camera.entity.setPosition(params.position.x, params.position.y, params.position.z);
        }
        if (params.target) {
            this.camera.entity.lookAt(params.target.x, params.target.y, params.target.z);
        }
    }

    // 相机参数管理系统
    private createCameraParamsManager() {
        return {
            // 保存当前独立相机参数到巡检点位
            saveToMarker: (marker: any) => {
                if (!marker || !this.camera?.entity?.camera) return;
                
                const camera = this.camera.entity.camera;
                const entity = this.camera.entity;
                
                // 获取相机位置和目标
                const position = entity.getPosition();
                const forward = entity.forward;
                const target = new Vec3().add2(position, forward.clone().mulScalar(10));
                
                const params = {
                    position: { x: position.x, y: position.y, z: position.z },
                    target: { x: target.x, y: target.y, z: target.z },
                    fov: camera.fov,
                    nearClip: camera.nearClip,
                    farClip: camera.farClip,
                    aperture: camera.aperture || 16,
                    sensitivity: camera.sensitivity || 1000,
                    shutter: camera.shutter || 60,
                    toneMapping: camera.toneMapping || 0,
                    timestamp: Date.now()
                };
                
                // 触发参数更新事件
                this.events.fire('camera.params.updated', {
                    marker: marker,
                    params: params
                });
                
                console.log('独立相机参数已保存到巡检点位:', marker.name, params);
                return params;
            },
            
            // 从巡检点位加载参数到独立相机
            loadFromMarker: (marker: any) => {
                if (!marker || !this.camera?.entity?.camera) return;
                
                const inspectionPoints = this.scene.inspectionPoints;
                const markerData = inspectionPoints.get(marker.name);
                
                if (markerData && markerData.cameraParams) {
                    this.syncIndependentCameraParams(markerData.cameraParams);
                    console.log('从巡检点位加载参数到独立相机:', marker.name);
                    return markerData.cameraParams;
                }
                
                return null;
            },
            
            // 重置独立相机参数为默认值
            resetToDefaults: () => {
                if (!this.camera?.entity?.camera) return;
                
                const defaultParams = {
                    fov: 75,
                    nearClip: 0.1,
                    farClip: 1000,
                    aperture: 16,
                    sensitivity: 1000,
                    shutter: 60,
                    toneMapping: 0
                };
                
                this.syncIndependentCameraParams(defaultParams);
                console.log('独立相机参数已重置为默认值');
                return defaultParams;
            },
            
            // 复制主相机参数到独立相机
            copyFromMainCamera: () => {
                if (!this.camera?.entity?.camera || !this.scene.camera?.entity?.camera) return;
                
                const mainCamera = this.scene.camera.entity.camera;
                const mainEntity = this.scene.camera.entity;
                
                const position = mainEntity.getPosition();
                const forward = mainEntity.forward;
                const target = new Vec3().add2(position, forward.clone().mulScalar(10));
                
                const params = {
                    position: { x: position.x, y: position.y, z: position.z },
                    target: { x: target.x, y: target.y, z: target.z },
                    fov: mainCamera.fov,
                    nearClip: mainCamera.nearClip,
                    farClip: mainCamera.farClip,
                    aperture: mainCamera.aperture || 16,
                    sensitivity: mainCamera.sensitivity || 1000,
                    shutter: mainCamera.shutter || 60,
                    toneMapping: mainCamera.toneMapping || 0
                };
                
                this.syncIndependentCameraParams(params);
                console.log('已复制主相机参数到独立相机');
                return params;
            },
            
            // 获取指定标记的相机参数
            getParams: (markerId: string) => {
                if (!markerId) return null;
                
                const inspectionPoints = this.scene.inspectionPoints;
                const markerData = inspectionPoints.get(markerId);
                
                if (markerData && markerData.cameraParams) {
                    return markerData.cameraParams;
                }
                
                // 如果没有保存的参数，返回默认参数
                return {
                    position: { x: 0, y: 0, z: 10 },
                    target: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    fov: 75,
                    nearClip: 0.1,
                    farClip: 1000,
                    aperture: 16,
                    sensitivity: 1000,
                    shutter: 60,
                    toneMapping: 0
                };
            }
        };
    }

    private addDragFunctionality() {
        let isDragging = false;
        const dragOffset = { x: 0, y: 0 };
        let dragHandle: HTMLElement | null = null;

        // 找到面板头部作为拖拽句柄
        const headerElements = this.dom.querySelectorAll('.snapshot-titlebar');
        if (headerElements.length > 0) {
            dragHandle = headerElements[0] as HTMLElement;
            dragHandle.style.cursor = 'move';

            const onPointerDown = (e: PointerEvent) => {
                // 只响应左键点击
                if (e.button !== 0) return;

                // 检查点击的是否是关闭按钮，如果是则不进行拖拽
                const target = e.target as HTMLElement;
                if (target.closest('.snapshot-close')) {
                    return;
                }

                isDragging = true;
                const rect = this.dom.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;

                // 设置面板为绝对定位
                this.dom.style.position = 'absolute';
                this.dom.style.zIndex = '1000';

                // 捕获指针，确保鼠标移出元素时仍能响应事件
                dragHandle!.setPointerCapture(e.pointerId);

                e.preventDefault();
                e.stopPropagation();
            };

            const onPointerMove = (e: PointerEvent) => {
                if (!isDragging) return;

                const newX = e.clientX - dragOffset.x;
                const newY = e.clientY - dragOffset.y;

                // 限制拖拽范围在窗口内
                const maxX = window.innerWidth - this.dom.offsetWidth;
                const maxY = window.innerHeight - this.dom.offsetHeight;

                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedY = Math.max(0, Math.min(newY, maxY));

                this.dom.style.left = `${clampedX}px`;
                this.dom.style.top = `${clampedY}px`;

                e.preventDefault();
                e.stopPropagation();
            };

            const onPointerUp = (e: PointerEvent) => {
                if (isDragging) {
                    isDragging = false;
                    this.dom.style.zIndex = '100';

                    // 释放指针捕获
                    if (dragHandle!.hasPointerCapture(e.pointerId)) {
                        dragHandle!.releasePointerCapture(e.pointerId);
                    }

                    e.preventDefault();
                    e.stopPropagation();
                }
            };

            // 绑定事件到拖拽句柄
            dragHandle.addEventListener('pointerdown', onPointerDown);
            dragHandle.addEventListener('pointermove', onPointerMove);
            dragHandle.addEventListener('pointerup', onPointerUp);
            dragHandle.addEventListener('pointercancel', onPointerUp);
        }
    }

    private closePanel() {
        this.hidden = true;
        this.isActive = false;
        this.stopRendering();
    }

    private showPanel() {
        this.hidden = false;
    }

    private setupEventListeners() {
        // 监听marker选择事件
        this.events.on('marker.selected', (marker: any) => {
            // 只有在快照预览激活时才处理marker选择事件
            const snapshotPreviewEnabled = this.events.invoke('snapshot.isEnabled');
            if (snapshotPreviewEnabled) {
                this.setMarker(marker);
            }
        });

        // 监听marker变换事件
        this.events.on('marker.transformed', (marker: any) => {
            if (this.currentMarker === marker) {
                this.updateCameraFromMarker();
            }
        });

        // 移除对主相机参数更新事件的监听，确保快照相机独立性
        // 不再监听 'camera.params.updated' 事件，避免与主相机同步

        // 点击预览窗口切换到marker视角 - 阻止事件冒泡
        this.canvas.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            if (this.currentMarker) {
                this.events.fire('camera.setToMarker', this.currentMarker);
            }
        });
        
        // 只对canvas和非拖动相关的事件进行阻止，保留拖动功能
        const eventTypes = ['wheel', 'contextmenu'];
        
        eventTypes.forEach(eventType => {
            this.dom.addEventListener(eventType, (event) => {
                event.stopPropagation();
                event.preventDefault();
            }, true);
        });

        // 为canvas添加完整的事件阻止（除了拖动相关事件）
        const canvasEventTypes = ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu', 'click', 'dblclick', 'pointerdown', 'pointerup', 'pointermove'];
        canvasEventTypes.forEach(eventType => {
            this.canvas.addEventListener(eventType, (event) => {
                event.stopPropagation();
                if (eventType === 'wheel' || eventType === 'contextmenu') {
                    event.preventDefault();
                }
            }, true);
        });

        // 添加clickable和active状态切换 - 阻止事件冒泡
        this.dom.addEventListener('mouseenter', () => {
            if (!this.isActive) {
                this.dom.classList.add('clickable');
            }
        });

        this.dom.addEventListener('mouseleave', () => {
            this.dom.classList.remove('clickable');
        });

        this.dom.addEventListener('click', (event) => {
            // 检查是否点击的是标题栏，如果是则不处理（让拖动功能处理）
            const titlebar = this.dom.querySelector('.snapshot-titlebar') as HTMLElement;
            if (titlebar && titlebar.contains(event.target as Node)) {
                return; // 让拖动功能处理标题栏点击
            }
            
            event.stopPropagation();
            event.preventDefault();
            this.setActive(!this.isActive);
        });
    }

    setActive(active: boolean) {
        this.isActive = active;
        
        if (active) {
            this.dom.classList.add('active');
            this.dom.classList.remove('clickable');
        } else {
            this.dom.classList.remove('active');
        }
        
        // 触发激活状态变化事件
        this.events.fire('snapshot.activeChanged', { active, marker: this.currentMarker });
    }

    setMarker(marker: any) {
        this.currentMarker = marker;
        
        if (marker) {
            // 激活独立相机并同步参数
            this.activateIndependentCamera();
            this.syncCameraWithMarkerParams();
            
            // 从巡检点位加载参数到独立相机
            this.cameraParamsManager.loadFromMarker(marker);
            
            // 更新UI显示
            this.updateControlsFromCamera();
            
            this.show();
        } else {
            // 停用独立相机
            this.deactivateIndependentCamera();
            this.hide();
        }
    }

    updateMarker(marker: any) {
        this.setMarker(marker);
    }

    private updateCameraFromMarker() {
        // 这个方法现在由 syncCameraWithMarkerParams 替代
        // 保留为兼容性，但实际逻辑已移至独立相机同步方法
        this.syncCameraWithMarkerParams();
    }

    private updateControlsFromMarker() {
        if (!this.currentMarker) return;
        
        const inspectionPoints = this.scene.inspectionPoints;
        const markerData = inspectionPoints.get(this.currentMarker.name);
        
        if (markerData && markerData.cameraParams) {
            const params = markerData.cameraParams;
            
            // 更新控制面板的值
            (this.cameraControlsPanel.querySelector('#fov-slider') as HTMLInputElement).value = (params.fov || 75).toString();
            (this.cameraControlsPanel.querySelector('#near-clip') as HTMLInputElement).value = (params.nearClip || 0.1).toString();
            (this.cameraControlsPanel.querySelector('#far-clip') as HTMLInputElement).value = (params.farClip || 1000).toString();
            (this.cameraControlsPanel.querySelector('#aperture') as HTMLInputElement).value = (params.aperture || 16).toString();
            (this.cameraControlsPanel.querySelector('#sensitivity') as HTMLInputElement).value = (params.sensitivity || 1000).toString();
            (this.cameraControlsPanel.querySelector('#shutter') as HTMLInputElement).value = (params.shutter || 60).toString();
            (this.cameraControlsPanel.querySelector('#tone-mapping') as HTMLSelectElement).value = (params.toneMapping || 0).toString();
        }
    }

    show() {
        this.showPanel();
        this.startRendering();
    }

    hide() {
        this.closePanel();
    }

    private startRendering() {
        // 激活独立相机进行渲染
        this.activateIndependentCamera();
        
        // 设置渲染状态
        this.renderingActive = true;
        
        // 开始渲染循环
        this.render();
    }

    private stopRendering() {
        // 停用独立相机
        this.deactivateIndependentCamera();
        
        // 停止渲染状态
        this.renderingActive = false;
    }

    private render() {
        if (!this.isActive || !this.renderingActive) return;
        
        // 延迟加载相机
        if (!this.camera || !this.camera.entity.camera) {
            this.camera = this.createIndependentCamera();
        }
        
        // 检查相机是否可用
        if (!this.camera.entity.camera) {
            console.warn('独立相机不可用');
            return;
        }
        
        try {
            this.renderCameraView();
        } catch (error) {
            console.error('快照预览渲染失败:', error);
            // 降级到基础预览
            const ctx = this.canvas.getContext('2d');
            if (ctx) {
                this.renderBasicPreview(ctx);
            }
        }
        
        // 继续渲染循环
        if (this.renderingActive) {
            requestAnimationFrame(() => this.render());
        }
    }

    /**
     * 渲染相机视图
     */
    private renderCameraView() {
        const ctx = this.canvas.getContext('2d');
        if (!ctx || !this.camera || !this.camera.entity.camera) {
            return;
        }
        
        const app = this.scene.app;
        const cameraComponent = this.camera.entity.camera;
        
        // 同步相机参数到标记点位
        this.syncCameraWithMarkerParams();
        
        try {
            // 简化渲染逻辑：直接使用主相机的渲染结果
            const mainCamera = this.scene.camera.entity.camera;
            
            // 保存主相机的当前状态
            const originalPosition = this.scene.camera.entity.getPosition().clone();
            const originalRotation = this.scene.camera.entity.getEulerAngles().clone();
            
            // 临时设置主相机到快照相机的位置和角度
            this.scene.camera.entity.setPosition(this.camera.entity.getPosition());
            this.scene.camera.entity.setEulerAngles(this.camera.entity.getEulerAngles());
            
            // 强制渲染一帧
            app.renderNextFrame = true;
            app.render();
            
            // 从主画布复制内容到快照画布
            setTimeout(() => {
                try {
                    // 恢复主相机状态
                    this.scene.camera.entity.setPosition(originalPosition);
                    this.scene.camera.entity.setEulerAngles(originalRotation);
                    
                    // 获取主画布内容并缩放到快照画布
                    const mainCanvas = app.graphicsDevice.canvas;
                    if (mainCanvas) {
                        // 清空快照画布
                        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                        
                        // 绘制主画布内容到快照画布
                        ctx.drawImage(mainCanvas, 0, 0, this.canvas.width, this.canvas.height);
                        
                        // 添加标记信息覆盖层
                        this.drawMarkerInfo(ctx);
                    } else {
                        this.renderBasicPreview(ctx);
                    }
                } catch (error) {
                    console.warn('快照渲染后处理失败:', error);
                    this.renderBasicPreview(ctx);
                }
            }, 16); // 等待一帧时间
            
        } catch (error) {
            console.warn('快照相机渲染失败:', error);
            this.renderBasicPreview(ctx);
        }
    }
    
    /**
     * 从渲染目标读取像素数据到Canvas
     */
    private readRenderTargetToCanvas(ctx: CanvasRenderingContext2D, renderTarget: RenderTarget) {
        try {
            if (!renderTarget || !renderTarget.colorBuffer) {
                console.warn('渲染目标无效');
                this.renderBasicPreview(ctx);
                return;
            }
            
            const device = this.scene.graphicsDevice as WebglGraphicsDevice;
            const gl = device.gl;
            const colorBuffer = renderTarget.colorBuffer;
            
            const width = this.canvas.width;
            const height = this.canvas.height;
            
            // 绑定渲染目标的帧缓冲区
            const framebuffer = (renderTarget as any)._glFrameBuffer;
            if (!framebuffer) {
                console.warn('帧缓冲区不可用');
                this.renderBasicPreview(ctx);
                return;
            }
            
            // 绑定帧缓冲区并读取像素
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            
            // 创建像素数据数组
            const pixels = new Uint8Array(width * height * 4);
            
            // 读取像素数据
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            
            // 恢复默认帧缓冲区
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            
            // 创建ImageData并绘制到Canvas
            const imageData = new ImageData(width, height);
            
            // 翻转Y轴（OpenGL坐标系与Canvas坐标系不同）
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcIndex = ((height - 1 - y) * width + x) * 4;
                    const dstIndex = (y * width + x) * 4;
                    
                    imageData.data[dstIndex] = pixels[srcIndex];     // R
                    imageData.data[dstIndex + 1] = pixels[srcIndex + 1]; // G
                    imageData.data[dstIndex + 2] = pixels[srcIndex + 2]; // B
                    imageData.data[dstIndex + 3] = pixels[srcIndex + 3]; // A
                }
            }
            
            // 绘制到Canvas
            ctx.putImageData(imageData, 0, 0);
            
            // 添加标记信息覆盖层
            this.drawMarkerInfo(ctx);
            
        } catch (error) {
            console.warn('读取渲染目标失败:', error);
            this.renderBasicPreview(ctx);
        }
    }
    
    /**
     * 绘制标记信息
     */
    private drawMarkerInfo(ctx: CanvasRenderingContext2D) {
        if (!this.currentMarker) return;
        
        // 设置文字样式
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, this.canvas.height - 60, this.canvas.width, 60);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        
        // 绘制标记信息
        const markerInfo = `标记: ${this.currentMarker.name || this.currentMarker.id}`;
        const timestamp = new Date().toLocaleTimeString();
        
        ctx.fillText(markerInfo, 10, this.canvas.height - 35);
        ctx.fillText(`时间: ${timestamp}`, 10, this.canvas.height - 15);
    }
    
    private renderBasicPreview(ctx: CanvasRenderingContext2D) {
        // 清除画布 - 使用深灰色背景
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制边框
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, this.canvas.width - 2, this.canvas.height - 2);
        
        // 绘制简单的预览内容
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('快照预览', this.canvas.width / 2, this.canvas.height / 2 - 10);
        
        if (this.currentMarker) {
            ctx.font = '12px Arial';
            ctx.fillStyle = '#4CAF50';
            ctx.fillText(`标记: ${this.currentMarker.name || '未命名'}`, this.canvas.width / 2, this.canvas.height / 2 + 10);
        } else {
            ctx.font = '12px Arial';
            ctx.fillStyle = '#cccccc';
            ctx.fillText('请选择一个标记', this.canvas.width / 2, this.canvas.height / 2 + 10);
        }
        
        // 添加时间戳显示渲染更新
        const now = new Date();
        ctx.font = '10px Arial';
        ctx.fillStyle = '#888888';
        ctx.textAlign = 'right';
        ctx.fillText(`${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`, this.canvas.width - 10, this.canvas.height - 10);
    }

    destroy() {
        // 停用并清理独立相机
        this.deactivateIndependentCamera();
        
        // 从场景中移除独立相机实体
        if (this.camera && this.camera.entity && this.camera.entity.parent) {
            this.camera.entity.parent.removeChild(this.camera.entity);
        }
        
        // 清理渲染目标
        if (this.camera && this.camera.entity.camera.renderTarget) {
            const renderTarget = this.camera.entity.camera.renderTarget;
            if (renderTarget.colorBuffer) {
                renderTarget.colorBuffer.destroy();
            }
            renderTarget.destroy();
        }
        
        // 清理相机实体
        if (this.camera && this.camera.entity) {
            this.camera.entity.destroy();
        }
        
        // PCUI Container 会自动处理DOM清理，不需要手动移除
        
        // 清理引用
        this.camera = null;
        this.currentMarker = null;
        this.canvas = null;
        this.cameraControlsPanel = null;
    }
}

export { SnapshotView };
