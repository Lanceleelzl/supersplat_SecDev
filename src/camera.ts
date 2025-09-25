import {
    math,
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_NEAREST,
    PIXELFORMAT_RGBA8,
    PIXELFORMAT_DEPTH,
    PROJECTION_ORTHOGRAPHIC,
    PROJECTION_PERSPECTIVE,
    TONEMAP_NONE,
    TONEMAP_ACES,
    TONEMAP_ACES2,
    TONEMAP_FILMIC,
    TONEMAP_HEJL,
    TONEMAP_LINEAR,
    TONEMAP_NEUTRAL,
    BoundingBox,
    Entity,
    Picker,
    Plane,
    Ray,
    RenderTarget,
    Texture,
    Vec3,
    WebglGraphicsDevice
} from 'playcanvas';

import { PointerController } from './controllers';
import { Element, ElementType } from './element';
import { GltfModel } from './gltf-model';
import { Serializer } from './serializer';
import { Splat } from './splat';
import { TweenValue } from './tween-value';

// calculate the forward vector given azimuth and elevation
const calcForwardVec = (result: Vec3, azim: number, elev: number) => {
    const ex = elev * math.DEG_TO_RAD;
    const ey = azim * math.DEG_TO_RAD;
    const s1 = Math.sin(-ex);
    const c1 = Math.cos(-ex);
    const s2 = Math.sin(-ey);
    const c2 = Math.cos(-ey);
    result.set(-c1 * s2, s1, c1 * c2);
};

// work globals
const forwardVec = new Vec3();
const cameraPosition = new Vec3();
const plane = new Plane();
const ray = new Ray();
const vec = new Vec3();
const vecb = new Vec3();
const va = new Vec3();

// modulo dealing with negative numbers
const mod = (n: number, m: number) => ((n % m) + m) % m;

class Camera extends Element {
    static debugPick = false; // 默认关闭拾取调试，需时设为 true
    controller: PointerController;
    entity: Entity;
    focalPointTween = new TweenValue({ x: 0, y: 0.5, z: 0 });
    azimElevTween = new TweenValue({ azim: 30, elev: -15 });
    distanceTween = new TweenValue({ distance: 1 });

    minElev = -90;
    maxElev = 90;

    sceneRadius = 1;

    flySpeed = 5;

    picker: Picker;

    workRenderTarget: RenderTarget;

    // overridden target size
    targetSize: { width: number, height: number } = null;

    suppressFinalBlit = false;

    renderOverlays = true;

    updateCameraUniforms: () => void;

    constructor() {
        super(ElementType.camera);
        // create the camera entity
        this.entity = new Entity('Camera');
        this.entity.addComponent('camera');

        // NOTE: this call is needed for refraction effect to work correctly, but
        // it slows rendering and should only be made when required.
        // this.entity.camera.requestSceneColorMap(true);
    }

    // ortho
    set ortho(value: boolean) {
        if (value !== this.ortho) {
            this.entity.camera.projection = value ? PROJECTION_ORTHOGRAPHIC : PROJECTION_PERSPECTIVE;
            this.scene.events.fire('camera.ortho', value);
        }
    }

    get ortho() {
        return this.entity.camera.projection === PROJECTION_ORTHOGRAPHIC;
    }

    // fov
    set fov(value: number) {
        this.entity.camera.fov = value;
    }

    get fov() {
        return this.entity.camera.fov;
    }

    // tonemapping
    set tonemapping(value: string) {
        const mapping: Record<string, number> = {
            none: TONEMAP_NONE,
            linear: TONEMAP_LINEAR,
            neutral: TONEMAP_NEUTRAL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL
        };

        const tvalue = mapping[value];

        if (tvalue !== undefined && tvalue !== this.entity.camera.toneMapping) {
            this.entity.camera.toneMapping = tvalue;
            this.scene.events.fire('camera.tonemapping', value);
        }
    }

    get tonemapping() {
        switch (this.entity.camera.toneMapping) {
            case TONEMAP_NONE: return 'none';
            case TONEMAP_LINEAR: return 'linear';
            case TONEMAP_NEUTRAL: return 'neutral';
            case TONEMAP_ACES: return 'aces';
            case TONEMAP_ACES2: return 'aces2';
            case TONEMAP_FILMIC: return 'filmic';
            case TONEMAP_HEJL: return 'hejl';
        }
        return 'none';
    }

    // near clip
    set near(value: number) {
        this.entity.camera.nearClip = value;
    }

    get near() {
        return this.entity.camera.nearClip;
    }

    // far clip
    set far(value: number) {
        this.entity.camera.farClip = value;
    }

    get far() {
        return this.entity.camera.farClip;
    }

    // focal point
    get focalPoint() {
        const t = this.focalPointTween.target;
        return new Vec3(t.x, t.y, t.z);
    }

    // azimuth, elevation
    get azimElev() {
        return this.azimElevTween.target;
    }

    get azim() {
        return this.azimElev.azim;
    }

    get elevation() {
        return this.azimElev.elev;
    }

    get distance() {
        return this.distanceTween.target.distance;
    }

    setFocalPoint(point: Vec3, dampingFactorFactor: number = 1) {
        this.focalPointTween.goto(point, dampingFactorFactor * this.scene.config.controls.dampingFactor);
    }

    setAzimElev(azim: number, elev: number, dampingFactorFactor: number = 1) {
        // clamp
        azim = mod(azim, 360);
        elev = Math.max(this.minElev, Math.min(this.maxElev, elev));

        const t = this.azimElevTween;
        t.goto({ azim, elev }, dampingFactorFactor * this.scene.config.controls.dampingFactor);

        // handle wraparound
        if (t.source.azim - azim < -180) {
            t.source.azim += 360;
        } else if (t.source.azim - azim > 180) {
            t.source.azim -= 360;
        }

        // return to perspective mode on rotation
        this.ortho = false;
    }

    setDistance(distance: number, dampingFactorFactor: number = 1) {
        const controls = this.scene.config.controls;

        // clamp
        distance = Math.max(controls.minZoom, Math.min(controls.maxZoom, distance));

        const t = this.distanceTween;
        t.goto({ distance }, dampingFactorFactor * controls.dampingFactor);
    }

    setPose(position: Vec3, target: Vec3, dampingFactorFactor: number = 1) {
        vec.sub2(target, position);
        const l = vec.length();
        const azim = Math.atan2(-vec.x / l, -vec.z / l) * math.RAD_TO_DEG;
        const elev = Math.asin(vec.y / l) * math.RAD_TO_DEG;
        this.setFocalPoint(target, dampingFactorFactor);
        this.setAzimElev(azim, elev, dampingFactorFactor);
        this.setDistance(l / this.sceneRadius * this.fovFactor, dampingFactorFactor);
    }

    // convert world to screen coordinate
    worldToScreen(world: Vec3, screen: Vec3) {
        this.entity.camera.worldToScreen(world, screen);
    }

    add() {
        this.scene.cameraRoot.addChild(this.entity);
        this.entity.camera.layers = this.entity.camera.layers.concat([
            this.scene.shadowLayer.id,
            this.scene.debugLayer.id,
            this.scene.gizmoLayer.id
        ]);

        if (this.scene.config.camera.debugRender) {
            this.entity.camera.setShaderPass(`debug_${this.scene.config.camera.debugRender}`);
        }

        const target = document.getElementById('canvas-container');

        this.controller = new PointerController(this, target);

        // apply scene config
        const config = this.scene.config;
        const controls = config.controls;

        // configure background
        this.entity.camera.clearColor.set(0, 0, 0, 0);

        this.minElev = (controls.minPolarAngle * 180) / Math.PI - 90;
        this.maxElev = (controls.maxPolarAngle * 180) / Math.PI - 90;

        // tonemapping
        this.scene.camera.entity.camera.toneMapping = {
            linear: TONEMAP_LINEAR,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            neutral: TONEMAP_NEUTRAL
        }[config.camera.toneMapping];

        // exposure
        this.scene.app.scene.exposure = config.camera.exposure;

        this.fov = config.camera.fov;

        // initial camera position and orientation
        this.setAzimElev(controls.initialAzim, controls.initialElev, 0);
        this.setDistance(controls.initialZoom, 0);

        // picker
        const { width, height } = this.scene.targetSize;
        this.picker = new Picker(this.scene.app, width, height);

        // override buffer allocation to use our render target
        this.picker.allocateRenderTarget = () => { };
        this.picker.releaseRenderTarget = () => { };

        this.scene.events.on('scene.boundChanged', this.onBoundChanged, this);

        // prepare camera-specific uniforms
        this.updateCameraUniforms = () => {
            const device = this.scene.graphicsDevice;
            const entity = this.entity;
            const camera = entity.camera;

            const set = (name: string, vec: Vec3) => {
                device.scope.resolve(name).setValue([vec.x, vec.y, vec.z]);
            };

            // get frustum corners in world space
            const points = camera.camera.getFrustumCorners(-100);
            const worldTransform = entity.getWorldTransform();
            for (let i = 0; i < points.length; i++) {
                worldTransform.transformPoint(points[i], points[i]);
            }

            // near
            if (camera.projection === PROJECTION_PERSPECTIVE) {
                // perspective
                set('near_origin', worldTransform.getTranslation());
                set('near_x', Vec3.ZERO);
                set('near_y', Vec3.ZERO);
            } else {
                // orthographic
                set('near_origin', points[3]);
                set('near_x', va.sub2(points[0], points[3]));
                set('near_y', va.sub2(points[2], points[3]));
            }

            // far
            set('far_origin', points[7]);
            set('far_x', va.sub2(points[4], points[7]));
            set('far_y', va.sub2(points[6], points[7]));
        };
    }

    remove() {
        this.controller.destroy();
        this.controller = null;

        this.entity.camera.layers = this.entity.camera.layers.filter(layer => layer !== this.scene.shadowLayer.id);
        this.scene.cameraRoot.removeChild(this.entity);

        // destroy doesn't exist on picker?
        // this.picker.destroy();
        this.picker = null;

        this.scene.events.off('scene.boundChanged', this.onBoundChanged, this);
    }

    // handle the scene's bound changing. the camera must be configured to render
    // the entire extents as well as possible.
    // also update the existing camera distance to maintain the current view
    onBoundChanged(bound: BoundingBox) {
        const prevDistance = this.distanceTween.value.distance * this.sceneRadius;
        this.sceneRadius = Math.max(1e-03, bound.halfExtents.length());
        this.setDistance(prevDistance / this.sceneRadius, 0);
    }

    serialize(serializer: Serializer) {
        serializer.packa(this.entity.getWorldTransform().data);
        serializer.pack(
            this.fov,
            this.tonemapping,
            this.entity.camera.renderTarget?.width,
            this.entity.camera.renderTarget?.height
        );
    }

    // handle the viewer canvas resizing
    rebuildRenderTargets() {
        const device = this.scene.graphicsDevice;
        const { width, height } = this.targetSize ?? this.scene.targetSize;

        const rt = this.entity.camera.renderTarget;
        if (rt && rt.width === width && rt.height === height) {
            return;
        }

        // out with the old
        if (rt) {
            rt.destroyTextureBuffers();
            rt.destroy();

            this.workRenderTarget.destroy();
            this.workRenderTarget = null;
        }

        const createTexture = (name: string, width: number, height: number, format: number) => {
            return new Texture(device, {
                name,
                width,
                height,
                format,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        };

        // in with the new
        const colorBuffer = createTexture('cameraColor', width, height, PIXELFORMAT_RGBA8);
        const depthBuffer = createTexture('cameraDepth', width, height, PIXELFORMAT_DEPTH);
        const renderTarget = new RenderTarget({
            colorBuffer,
            depthBuffer,
            flipY: false,
            autoResolve: false
        });
        this.entity.camera.renderTarget = renderTarget;
        this.entity.camera.horizontalFov = width > height;

        const workColorBuffer = createTexture('workColor', width, height, PIXELFORMAT_RGBA8);

        // create pick mode render target (reuse color buffer)
        this.workRenderTarget = new RenderTarget({
            colorBuffer: workColorBuffer,
            depth: false,
            autoResolve: false
        });

        // set picker render target
        this.picker.renderTarget = this.workRenderTarget;

        this.scene.events.fire('camera.resize', { width, height });
    }

    onUpdate(deltaTime: number) {
        // controller update
        this.controller.update(deltaTime);

        // update underlying values
        this.focalPointTween.update(deltaTime);
        this.azimElevTween.update(deltaTime);
        this.distanceTween.update(deltaTime);

        const azimElev = this.azimElevTween.value;
        const distance = this.distanceTween.value;

        calcForwardVec(forwardVec, azimElev.azim, azimElev.elev);
        cameraPosition.copy(forwardVec);
        cameraPosition.mulScalar(distance.distance * this.sceneRadius / this.fovFactor);
        cameraPosition.add(this.focalPointTween.value);

        this.entity.setLocalPosition(cameraPosition);
        this.entity.setLocalEulerAngles(azimElev.elev, azimElev.azim, 0);

        this.fitClippingPlanes(this.entity.getLocalPosition(), this.entity.forward);

        const { camera } = this.entity;
        camera.orthoHeight = this.distanceTween.value.distance * this.sceneRadius / this.fovFactor * (this.fov / 90) * (camera.horizontalFov ? this.scene.targetSize.height / this.scene.targetSize.width : 1);
        camera.camera._updateViewProjMat();
    }

    fitClippingPlanes(cameraPosition: Vec3, forwardVec: Vec3) {
        const bound = this.scene.bound;
        const boundRadius = bound.halfExtents.length();

        vec.sub2(bound.center, cameraPosition);
        const dist = vec.dot(forwardVec);

        // Use more conservative clipping planes for better compatibility with various model sizes
        if (dist > 0) {
            // Set far plane with some extra margin
            this.far = Math.max(boundRadius * 4, dist + boundRadius * 2);
            
            // Calculate near plane more carefully
            if (dist < boundRadius) {
                // Camera is inside or very close to the bounding sphere
                this.near = Math.max(0.001, boundRadius / 10000);
            } else {
                // Camera is outside the bounding sphere
                this.near = Math.max(0.001, Math.min(dist - boundRadius, boundRadius / 100));
            }
        } else {
            // Scene is behind the camera - use generous bounds
            this.far = boundRadius * 6;
            this.near = Math.max(0.001, boundRadius / 10000);
        }
        
        // Ensure near is always smaller than far
        if (this.near >= this.far) {
            this.near = this.far / 1000;
        }
    }

    onPreRender() {
        this.rebuildRenderTargets();
        this.updateCameraUniforms();
    }

    onPostRender() {
        const device = this.scene.graphicsDevice as WebglGraphicsDevice;
        const renderTarget = this.entity.camera.renderTarget;

        // resolve msaa buffer
        if (renderTarget.samples > 1) {
            renderTarget.resolve(true, false);
        }

        // copy render target
        if (!this.suppressFinalBlit) {
            device.copyRenderTarget(renderTarget, null, true, false);
        }
    }

    focus(options?: { focalPoint: Vec3, radius: number, speed: number }) {
        const getSplatFocalPoint = () => {
            for (const element of this.scene.elements) {
                if (element.type === ElementType.splat) {
                    const focalPoint = (element as Splat).focalPoint?.();
                    if (focalPoint) {
                        return focalPoint;
                    }
                }
            }
        };

        const focalPoint = options ? options.focalPoint : (getSplatFocalPoint() ?? this.scene.bound.center);
        const focalRadius = options ? options.radius : this.scene.bound.halfExtents.length();

        const fdist = focalRadius / this.sceneRadius;

        this.setDistance(isFinite(fdist) ? fdist : 1, options?.speed ?? 0);
        this.setFocalPoint(focalPoint, options?.speed ?? 0);
    }

    get fovFactor() {
        // we set the fov of the longer axis. here we get the fov of the other (smaller) axis so framing
        // doesn't cut off the scene.
        const { width, height } = this.scene.targetSize;
        const aspect = (width && height) ? this.entity.camera.horizontalFov ? height / width : width / height : 1;
        const fov = 2 * Math.atan(Math.tan(this.fov * math.DEG_TO_RAD * 0.5) * aspect);
        return Math.sin(fov * 0.5);
    }

    // intersect the scene at the given screen coordinate and focus the camera on this location
    pickFocalPoint(screenX: number, screenY: number) {
        const scene = this.scene;
        const cameraPos = this.entity.getPosition();

        const target = scene.canvas;
        const sx = screenX / target.clientWidth * scene.targetSize.width;
        const sy = screenY / target.clientHeight * scene.targetSize.height;

        // =============================
        // Step 0: Physics-based raycast (if physics components are present)
        // 优先使用物理系统的精确射线检测（可与复杂 mesh collider 搭配）。
        // 若失败或物理未初始化，则继续后续 AABB / fallback / splat 逻辑。
        // =============================
        try {
            const cam = this.entity.camera;
            const dpr = window.devicePixelRatio || 1;
            const scaledX = screenX * dpr;
            const scaledY = screenY * dpr;
            const nearPoint = new Vec3();
            const farPoint = new Vec3();
            cam.screenToWorld(scaledX, scaledY, cam.nearClip, nearPoint);
            cam.screenToWorld(scaledX, scaledY, cam.farClip, farPoint);
            const physicsRayDir = farPoint.clone().sub(nearPoint).normalize();
            // Construct a physics ray using pc.Ray if available (avoid shadowing existing Ray import if types differ)
            // @ts-ignore
            const pcAny: any = (window as any).pc;
            if (pcAny && pcAny.Ray) {
                const ray = new pcAny.Ray(nearPoint, physicsRayDir);
                const result: any = {};
                if (pcAny.app?.systems?.rigidbody?.raycastFirst) {
                    const hit = pcAny.app.systems.rigidbody.raycastFirst(ray, result);
                    if (!hit && (scene as any).app?.systems?.rigidbody?.raycastFirst) {
                        // fallback to scene app reference if global pc.app not set
                        const hit2 = (scene as any).app.systems.rigidbody.raycastFirst(ray, result);
                        if (hit2) {
                            if (result?.entity?.tags?.has('pickable')) {
                                const modelEnt = result.entity;
                                // ascend to find _gltfModel reference
                                let cur = modelEnt as any;
                                let foundModel: GltfModel = null;
                                while (cur && !foundModel) {
                                    if (cur._gltfModel) foundModel = cur._gltfModel as GltfModel;
                                    cur = cur.parent;
                                }
                                if (foundModel) {
                                    if (Camera.debugPick) {
                                        console.log('🎯 Physics Raycast 命中 (fallback app)', { model: foundModel.filename });
                                    }
                                    scene.events.fire('camera.focalPointPicked', {
                                        camera: this,
                                        model: foundModel,
                                        position: result.point ? result.point.clone?.() || result.point : nearPoint
                                    });
                                    return;
                                }
                            }
                        }
                    } else if (hit) {
                        if (result?.entity?.tags?.has('pickable')) {
                            const modelEnt = result.entity;
                            let cur = modelEnt as any;
                            let foundModel: GltfModel = null;
                            while (cur && !foundModel) {
                                if (cur._gltfModel) foundModel = cur._gltfModel as GltfModel;
                                cur = cur.parent;
                            }
                            if (foundModel) {
                                if (Camera.debugPick) {
                                    console.log('🎯 Physics Raycast 命中', { model: foundModel.filename });
                                }
                                scene.events.fire('camera.focalPointPicked', {
                                    camera: this,
                                    model: foundModel,
                                    position: result.point ? result.point.clone?.() || result.point : nearPoint
                                });
                                return;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            if (Camera.debugPick) {
                console.warn('⚠️ Physics raycast 失败或未初始化', e);
            }
        }
        // First: GLB 模型拾取（多阶段）
        // 阶段顺序：
        // 1) meshInstance 局部 AABB -> world 转换后逐一射线测试（更精细）
        // 2) 模型整体聚合 worldBound AABB 测试（粗略）
        // 3) 中心投影 fallback
        const gltfModels = scene.getElementsByType(ElementType.model);
        if (!gltfModels.length) {
            // 仅提示一次（可选：放入静态集合避免骚扰，这里简单输出）
            console.warn('[Picking] 没有可用的 GLB 模型元素 (ElementType.model)。请确认已调用 scene.add(gltfModel)');
        }
        let pickedModel: GltfModel = null;
        let pickedPoint: Vec3 = null;
        let pickedDistance = Number.POSITIVE_INFINITY;

        if (gltfModels.length > 0) {
            const cam = this.entity.camera;
            const nearPoint = new Vec3();
            const farPoint = new Vec3();

            // 统一使用渲染目标尺寸 (考虑 DPR) 的转换
            // PlayCanvas 的 camera.screenToWorld 期望的是相对 canvas 的屏幕坐标（像素）
            // 但我们有可能在高 DPI 下使用 clientWidth / clientHeight 逻辑，故确保一致性
            const dpr = window.devicePixelRatio || 1;
            const scaledX = screenX * dpr;
            const scaledY = screenY * dpr;

            cam.screenToWorld(scaledX, scaledY, cam.nearClip, nearPoint);
            cam.screenToWorld(scaledX, scaledY, cam.farClip, farPoint);

            const rayDir = farPoint.sub(nearPoint).normalize();
            const pickRay = new Ray(nearPoint, rayDir);

            // Debug 可视化：绘制射线
            if (Camera.debugPick) {
                try {
                    const app: any = (scene as any).app;
                    const lineEnd = nearPoint.clone().add(rayDir.clone().mulScalar(1000));
                    app?.drawLine?.(nearPoint, lineEnd, new (window as any).pc.Color(1, 1, 0, 1));
                } catch { /* ignore visualization errors */ }
            }

            // 记录调试信息
            if (Camera.debugPick) {
                console.log('🎯 GLB Picking Ray', {
                    screen: { x: screenX, y: screenY, scaledX, scaledY, dpr },
                    near: nearPoint.toString(),
                    dir: rayDir.toString(),
                    modelCount: gltfModels.length
                });
            }

            const modelBounds: { model: GltfModel, bound: any }[] = [];

            // --- 阶段 1: meshInstance 级 AABB 拾取 ---
            for (let i = 0; i < gltfModels.length; i++) {
                const model = gltfModels[i] as GltfModel;
                if (!model.visible || !model.entity?.enabled) continue;
                const renderComponents: any[] = model.entity.findComponents('render') as any;
                for (const render of renderComponents) {
                    const meshInstances: any[] = (render as any).meshInstances || [];
                    for (const mi of meshInstances) {
                        if (!mi?.aabb || !mi?.node) continue;
                        // world 变换
                        const worldAabb = new BoundingBox();
                        worldAabb.setFromTransformedAabb(mi.aabb, mi.node.getWorldTransform());
                        const ip = new Vec3();
                        if (Camera.debugPick) {
                            // 画出 meshInstance AABB（线框）
                            try {
                                const app: any = (scene as any).app;
                                const bbMin = worldAabb.getMin();
                                const bbMax = worldAabb.getMax();
                                const corners = [
                                    new Vec3(bbMin.x, bbMin.y, bbMin.z),
                                    new Vec3(bbMax.x, bbMin.y, bbMin.z),
                                    new Vec3(bbMax.x, bbMax.y, bbMin.z),
                                    new Vec3(bbMin.x, bbMax.y, bbMin.z),
                                    new Vec3(bbMin.x, bbMin.y, bbMax.z),
                                    new Vec3(bbMax.x, bbMin.y, bbMax.z),
                                    new Vec3(bbMax.x, bbMax.y, bbMax.z),
                                    new Vec3(bbMin.x, bbMax.y, bbMax.z)
                                ];
                                const color = new (window as any).pc.Color(0, 0.6, 1, 1);
                                const drawE = (a: number, b: number) => app?.drawLine?.(corners[a], corners[b], color);
                                drawE(0, 1); drawE(1, 2); drawE(2, 3); drawE(3, 0); // bottom
                                drawE(4, 5); drawE(5, 6); drawE(6, 7); drawE(7, 4); // top
                                drawE(0, 4); drawE(1, 5); drawE(2, 6); drawE(3, 7); // pillars
                            } catch { /* ignore aabb visualization errors */ }
                        }
                        if (worldAabb.intersectsRay(pickRay, ip)) {
                            const distance = ip.clone().sub(nearPoint).length();
                            if (distance < pickedDistance) {
                                pickedDistance = distance;
                                pickedModel = model;
                                pickedPoint = ip.clone();
                                if (Camera.debugPick) {
                                    console.log('✅ meshInstance 命中', { model: model.filename, distance });
                                    try {
                                        const app: any = (scene as any).app;
                                        app?.drawLine?.(nearPoint, ip, new (window as any).pc.Color(1, 0, 0, 1));
                                    } catch { /* ignore */ }
                                }
                            } else if (Camera.debugPick) {
                                console.log('↩️ meshInstance 命中但更远', { model: model.filename, distance });
                            }
                        }
                    }
                }
            }

            if (pickedModel) {
                if (Camera.debugPick) console.log('🎯 通过 meshInstance 精细拾取命中', pickedModel.filename);
                scene.events.fire('camera.focalPointPicked', { camera: this, model: pickedModel, position: pickedPoint });
                return;
            }

            // --- 阶段 2: 模型聚合 worldBound AABB 拾取 ---
            for (let i = 0; i < gltfModels.length; i++) {
                const model = gltfModels[i] as GltfModel;
                if (!model.visible || !model.entity?.enabled) continue;
                const wb = model.worldBound; // 已缓存
                if (!wb) continue;
                modelBounds.push({ model, bound: wb });
                const ip = new Vec3();
                if (wb.intersectsRay(pickRay, ip)) {
                    const distance = ip.clone().sub(nearPoint).length();
                    if (Camera.debugPick) {
                        console.log('✅ GLB AABB Hit', {
                            model: model.filename,
                            distance,
                            ip: ip.toString(),
                            boundCenter: wb.center.toString(),
                            boundHalfExtents: wb.halfExtents.toString()
                        });
                        // 画出模型聚合 AABB
                        try {
                            const app: any = (scene as any).app;
                            const bbMin = wb.getMin();
                            const bbMax = wb.getMax();
                            const corners = [
                                new Vec3(bbMin.x, bbMin.y, bbMin.z),
                                new Vec3(bbMax.x, bbMin.y, bbMin.z),
                                new Vec3(bbMax.x, bbMax.y, bbMin.z),
                                new Vec3(bbMin.x, bbMax.y, bbMin.z),
                                new Vec3(bbMin.x, bbMin.y, bbMax.z),
                                new Vec3(bbMax.x, bbMin.y, bbMax.z),
                                new Vec3(bbMax.x, bbMax.y, bbMax.z),
                                new Vec3(bbMin.x, bbMax.y, bbMax.z)
                            ];
                            const color = new (window as any).pc.Color(0.9, 0.5, 0.1, 1);
                            const drawE = (a: number, b: number) => app?.drawLine?.(corners[a], corners[b], color);
                            drawE(0, 1); drawE(1, 2); drawE(2, 3); drawE(3, 0);
                            drawE(4, 5); drawE(5, 6); drawE(6, 7); drawE(7, 4);
                            drawE(0, 4); drawE(1, 5); drawE(2, 6); drawE(3, 7);
                        } catch { /* ignore */ }
                    }
                    if (distance < pickedDistance) {
                        pickedDistance = distance;
                        pickedModel = model;
                        pickedPoint = ip.clone();
                    }
                }
            }

            if (pickedModel) {
                // 仅触发选中，不改变相机焦点（保持行为轻量）
                scene.events.fire('camera.focalPointPicked', {
                    camera: this,
                    model: pickedModel,
                    position: pickedPoint
                });
                return; // 已成功选中 GLB，后续不再做 splat 拾取
            }

            // =============================
            // Fallback: 如果射线未命中任何 AABB，尝试基于包围盒中心投影的屏幕距离近似选取
            // 用于模型较大 / 视线角度特殊 / AABB 射线漏判的情况
            // =============================
            const fallbackCandidates: { model: GltfModel, dist2: number }[] = [];
            for (let i = 0; i < modelBounds.length; i++) {
                const { model, bound } = modelBounds[i];
                // 计算包围盒中心的屏幕坐标
                const sp = cam.worldToScreen(bound.center, va.clone());
                if (!sp) continue; // 极端情况
                // 只考虑在前方的
                if (sp.z < 0 || sp.z > 1) continue;
                const dx = screenX - sp.x;
                const dy = screenY - sp.y;
                const d2 = dx * dx + dy * dy;
                fallbackCandidates.push({ model, dist2: d2 });
                // 调试输出
                if (Camera.debugPick) {
                    console.log('🔁 Fallback candidate', {
                        model: model.filename,
                        screenCenter: { x: sp.x, y: sp.y, z: sp.z },
                        click: { x: screenX, y: screenY },
                        dist2: d2
                    });
                }
            }

            if (fallbackCandidates.length) {
                fallbackCandidates.sort((a, b) => a.dist2 - b.dist2);
                const best = fallbackCandidates[0];
                // 阈值 (像素^2)。25px 半径 => 625。可调整。
                if (best.dist2 < 625) {
                    if (Camera.debugPick) {
                        console.log('✅ Fallback 选中模型 (projection distance)', {
                            model: best.model.filename,
                            dist2: best.dist2
                        });
                    }
                    scene.events.fire('camera.focalPointPicked', {
                        camera: this,
                        model: best.model,
                        position: best.model.worldBound?.center.clone() || nearPoint
                    });
                    return;
                }
                if (Camera.debugPick) {
                    console.log('ℹ️ Fallback 放弃：最近模型中心距离过大', { dist2: best.dist2 });
                }
            }
        }

        // If no GLB model was picked, continue with splat picking
        const splats = scene.getElementsByType(ElementType.splat);

        let closestD = 0;
        const closestP = new Vec3();
        let closestSplat = null;

        for (let i = 0; i < splats.length; ++i) {
            const splat = splats[i] as Splat;

            this.pickPrep(splat, 'set');
            const pickId = this.pick(sx, sy);

            if (pickId !== -1) {
                splat.calcSplatWorldPosition(pickId, vec);

                // create a plane at the world position facing perpendicular to the camera
                plane.setFromPointNormal(vec, this.entity.forward);

                // create the pick ray in world space
                if (this.ortho) {
                    this.entity.camera.screenToWorld(screenX, screenY, -1.0, vec);
                    this.entity.camera.screenToWorld(screenX, screenY, 1.0, vecb);
                    vecb.sub(vec).normalize();
                    ray.set(vec, vecb);
                } else {
                    this.entity.camera.screenToWorld(screenX, screenY, 1.0, vec);
                    vec.sub(cameraPos).normalize();
                    ray.set(cameraPos, vec);
                }

                // find intersection
                if (plane.intersectsRay(ray, vec)) {
                    const distance = vecb.sub2(vec, ray.origin).length();
                    if (!closestSplat || distance < closestD) {
                        closestD = distance;
                        closestP.copy(vec);
                        closestSplat = splat;
                    }
                }
            }
        }

        if (closestSplat) {
            this.setFocalPoint(closestP);
            this.setDistance(closestD / this.sceneRadius * this.fovFactor);
            scene.events.fire('camera.focalPointPicked', {
                camera: this,
                splat: closestSplat,
                position: closestP
            });
        }
    }

    // pick mode

    // render picker contents
    pickPrep(splat: Splat, op: 'add'|'remove'|'set') {
        const { width, height } = this.scene.targetSize;
        const worldLayer = this.scene.app.scene.layers.getLayerByName('World');

        const device = this.scene.graphicsDevice;
        const events = this.scene.events;
        const alpha = events.invoke('camera.mode') === 'rings' ? 0.0 : 0.2;

        // hide non-selected elements
        const splats = this.scene.getElementsByType(ElementType.splat);
        splats.forEach((s: Splat) => {
            s.entity.enabled = s === splat;
        });

        device.scope.resolve('pickerAlpha').setValue(alpha);
        device.scope.resolve('pickMode').setValue(['add', 'remove', 'set'].indexOf(op));
        this.picker.resize(width, height);
        this.picker.prepare(this.entity.camera, this.scene.app.scene, [worldLayer]);

        // re-enable all splats
        splats.forEach((splat: Splat) => {
            splat.entity.enabled = true;
        });
    }

    pick(x: number, y: number) {
        return this.pickRect(x, y, 1, 1)[0];
    }

    pickRect(x: number, y: number, width: number, height: number) {
        const device = this.scene.graphicsDevice as WebglGraphicsDevice;
        const pixels = new Uint8Array(width * height * 4);

        // read pixels
        device.setRenderTarget(this.picker.renderTarget);
        device.updateBegin();
        device.readPixels(x, this.picker.renderTarget.height - y - height, width, height, pixels);
        device.updateEnd();

        const result: number[] = [];
        for (let i = 0; i < width * height; i++) {
            result.push(
                pixels[i * 4] |
                (pixels[i * 4 + 1] << 8) |
                (pixels[i * 4 + 2] << 16) |
                (pixels[i * 4 + 3] << 24)
            );
        }

        return result;
    }

    docSerialize() {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];

        return {
            focalPoint: pack3(this.focalPointTween.target),
            azim: this.azim,
            elev: this.elevation,
            distance: this.distance,
            fov: this.fov,
            tonemapping: this.tonemapping
        };
    }

    docDeserialize(settings: any) {
        this.setFocalPoint(new Vec3(settings.focalPoint), 0);
        this.setAzimElev(settings.azim, settings.elev, 0);
        this.setDistance(settings.distance, 0);
        this.fov = settings.fov;
        this.tonemapping = settings.tonemapping;
    }

    // offscreen render mode

    startOffscreenMode(width: number, height: number) {
        this.targetSize = { width, height };
        this.suppressFinalBlit = true;
    }

    endOffscreenMode() {
        this.targetSize = null;
        this.suppressFinalBlit = false;
    }

    // Pick GLB models without focusing camera (for selection only)
    pickModel(screenX: number, screenY: number) {
        // Deprecated: 现在统一使用 pickFocalPoint 完成 GLB + splat 拾取
        if (!(window as any)._warnPickModelOnce) {
            (window as any)._warnPickModelOnce = true;
            console.warn('[pickModel] 已废弃：请直接使用 pickFocalPoint');
        }
        this.pickFocalPoint(screenX, screenY);
    }
}

export { Camera };
