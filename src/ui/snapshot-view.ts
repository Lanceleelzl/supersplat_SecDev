import { Container, Label, Button, Element, NumericInput, Panel } from '@playcanvas/pcui';
import { Entity, RenderTarget, Texture, Vec3, PIXELFORMAT_RGBA8, FILTER_LINEAR, ADDRESS_CLAMP_TO_EDGE } from 'playcanvas';

import { Events } from '../events';
import { Scene } from '../scene';
import closeSvg from './svg/close.svg';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new Element({
        dom: new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement
    });
};

// 快照窗口，显示当前marker绑定的虚拟相机视角
export class SnapshotView extends Container {
    private title: Label;
    private viewport: HTMLCanvasElement;
    private currentMarker: any = null;
    private events: Events;
    private scene: Scene;
    private virtualCamera: any = null;
    private virtualCameraEntity: Entity | null = null;
    private renderTarget: RenderTarget | null = null;
    private isRendering: boolean = false;
    private animationId: number = 0;
    
    // 相机参数控制UI
    private cameraControlsPanel: Panel;
    private fovInput: NumericInput;
    private nearClipInput: NumericInput;
    private farClipInput: NumericInput;
    private heightInput: NumericInput;
    private pitchInput: NumericInput;
    constructor(events: Events, scene: Scene, args = {}) {
        super({
            ...args,
            class: 'snapshot-view'
        });
        this.events = events;
        this.scene = scene;

        // 创建标题栏
        const titleBar = new Container({ class: 'snapshot-titlebar' });
        this.title = new Label({ text: '快照预览', class: 'snapshot-title' });

        // 关闭按钮 - 完全参照属性面板实现
        const closeBtn = new Element({
            class: 'panel-header-close'
        });
        closeBtn.dom.appendChild(createSvg(closeSvg).dom);

        // 确保关闭按钮可点击并阻止事件穿透
        closeBtn.dom.style.cursor = 'pointer';
        closeBtn.dom.style.pointerEvents = 'auto';
        closeBtn.dom.style.zIndex = '1001';
        closeBtn.dom.style.position = 'relative';
        closeBtn.dom.style.backgroundColor = 'rgba(0,0,0,0.1)'; // 给一个半透明背景确保可点击区域
        closeBtn.dom.style.borderRadius = '2px';

        titleBar.append(this.title);
        titleBar.append(closeBtn);

        // 创建视口canvas
        this.viewport = document.createElement('canvas');
        this.viewport.className = 'snapshot-viewport';
        this.viewport.width = 320;
        this.viewport.height = 180;

        // 阻止canvas上的所有鼠标和触摸事件穿透到主视口
        this.viewport.style.pointerEvents = 'auto';
        this.viewport.style.position = 'relative';
        this.viewport.style.zIndex = '1000';
        
        // 阻止所有鼠标事件穿透
        ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel'].forEach(eventType => {
            this.viewport.addEventListener(eventType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }, true);
        });

        // 阻止触摸事件穿透
        ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(eventType => {
            this.viewport.addEventListener(eventType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }, true);
        });

        // 阻止指针事件穿透
        ['pointerdown', 'pointerup', 'pointermove', 'pointercancel'].forEach(eventType => {
            this.viewport.addEventListener(eventType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }, true);
        });

        this.append(titleBar);
        
        // 创建相机参数控制面板
        this.createCameraControlsPanel();
        this.append(this.cameraControlsPanel);
        
        this.append(this.viewport);

        // 确保整个快照面板也阻止事件穿透
        this.dom.style.pointerEvents = 'auto';
        this.dom.style.position = 'relative';
        this.dom.style.zIndex = '999';

        // 监听marker选择事件 - 统一由main.ts中的marker.selected事件处理
        this.events.on('marker.selected', (model: any) => {
            if (model && (model as any).isInspectionModel) {
                this.currentMarker = model;
                this.updateCameraFromMarker();
            }
        });

        // 监听marker位置变化
        this.events.on('marker.transform', (marker) => {
            if (this.currentMarker === marker) {
                console.log('SnapshotView: Marker transform detected, updating camera and preview');
                this.updateCameraFromMarker();
            }
        });

        // 监听快照窗口显示/隐藏事件
        this.events.on('snapshot.show', () => {
            this.hidden = false;
        });

        this.events.on('snapshot.hide', () => {
            this.hidden = true;
        });

        // 关闭按钮事件 - 强制阻止事件穿透
        closeBtn.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.closePanel();
            return false;
        }, true);

        // 也监听mousedown和pointerdown事件来完全阻止穿透
        closeBtn.dom.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }, true);

        closeBtn.dom.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }, true);

        // 添加拖拽功能
        this.setupDragging(titleBar);

        // 初始化虚拟相机和渲染目标
        this.initVirtualCamera();

        // 监听渲染事件 - 改为手动触发而不是自动监听
        // this.scene.app.on('postrender', this.drawPreviewToCanvas, this);
    }

    // 初始化虚拟相机
    private initVirtualCamera() {
        if (!this.scene || !this.scene.app) return;

        // 创建虚拟相机实体
        this.virtualCameraEntity = new Entity('SnapshotCamera');
        this.virtualCamera = this.virtualCameraEntity.addComponent('camera', {
            fov: 75,
            nearClip: 0.1,
            farClip: 1000,
            clearColor: [0.1, 0.1, 0.1, 1],
            enabled: false // 默认禁用，只在需要时启用
        });

        // 创建渲染目标
        const device = this.scene.app.graphicsDevice;
        this.renderTarget = new RenderTarget({
            colorBuffer: new Texture(device, {
                width: 320,
                height: 180,
                format: PIXELFORMAT_RGBA8,
                minFilter: FILTER_LINEAR,
                magFilter: FILTER_LINEAR,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            }),
            depth: true
        });

        // 不要在初始化时设置renderTarget，避免反馈循环
        // this.virtualCamera.renderTarget = this.renderTarget;
        
        // 将虚拟相机添加到场景根节点
        this.scene.app.root.addChild(this.virtualCameraEntity);
        
        console.log('SnapshotView: Virtual camera initialized with render target');
        console.log('SnapshotView: Render target size:', this.renderTarget.width, 'x', this.renderTarget.height);
    }

    // 创建相机参数控制面板
    private createCameraControlsPanel() {
        this.cameraControlsPanel = new Panel({
            class: 'camera-controls-panel',
            headerText: '相机参数',
            collapsible: true,
            collapsed: false
        });

        // 视野角度 (FOV) - 对应无人机相机的焦距控制
        const fovContainer = new Container({ class: 'camera-param-row' });
        const fovLabel = new Label({ text: '视野角度 (°)', class: 'camera-param-label' });
        this.fovInput = new NumericInput({
            value: 75,
            min: 10,
            max: 120,
            precision: 1,
            step: 1,
            class: 'camera-param-input'
        });
        fovContainer.append(fovLabel);
        fovContainer.append(this.fovInput);

        // 相机高度 - 对应无人机的飞行高度
        const heightContainer = new Container({ class: 'camera-param-row' });
        const heightLabel = new Label({ text: '相机高度 (m)', class: 'camera-param-label' });
        this.heightInput = new NumericInput({
            value: 2,
            min: 0.5,
            max: 50,
            precision: 1,
            step: 0.5,
            class: 'camera-param-input'
        });
        heightContainer.append(heightLabel);
        heightContainer.append(this.heightInput);

        // 俯仰角度 - 对应无人机云台的俯仰控制
        const pitchContainer = new Container({ class: 'camera-param-row' });
        const pitchLabel = new Label({ text: '俯仰角度 (°)', class: 'camera-param-label' });
        this.pitchInput = new NumericInput({
            value: -90,
            min: -90,
            max: 30,
            precision: 1,
            step: 5,
            class: 'camera-param-input'
        });
        pitchContainer.append(pitchLabel);
        pitchContainer.append(this.pitchInput);

        // 近裁剪距离 - 对应相机的最近对焦距离
        const nearContainer = new Container({ class: 'camera-param-row' });
        const nearLabel = new Label({ text: '近裁剪 (m)', class: 'camera-param-label' });
        this.nearClipInput = new NumericInput({
            value: 0.1,
            min: 0.01,
            max: 10,
            precision: 2,
            step: 0.1,
            class: 'camera-param-input'
        });
        nearContainer.append(nearLabel);
        nearContainer.append(this.nearClipInput);

        // 远裁剪距离 - 对应相机的最远可见距离
        const farContainer = new Container({ class: 'camera-param-row' });
        const farLabel = new Label({ text: '远裁剪 (m)', class: 'camera-param-label' });
        this.farClipInput = new NumericInput({
            value: 1000,
            min: 10,
            max: 10000,
            precision: 0,
            step: 100,
            class: 'camera-param-input'
        });
        farContainer.append(farLabel);
        farContainer.append(this.farClipInput);

        // 添加所有参数行到面板
        this.cameraControlsPanel.append(fovContainer);
        this.cameraControlsPanel.append(heightContainer);
        this.cameraControlsPanel.append(pitchContainer);
        this.cameraControlsPanel.append(nearContainer);
        this.cameraControlsPanel.append(farContainer);

        // 绑定参数变化事件
        this.bindCameraParamEvents();
    }

    // 绑定相机参数变化事件
    private bindCameraParamEvents() {
        // FOV变化
        this.fovInput.on('change', (value: number) => {
            if (this.virtualCamera) {
                this.virtualCamera.fov = value;
                this.updatePreviewFromParams();
                this.saveCameraParamsToMarker();
            }
        });

        // 高度变化
        this.heightInput.on('change', (value: number) => {
            this.updateCameraPosition();
            this.saveCameraParamsToMarker();
        });

        // 俯仰角变化
        this.pitchInput.on('change', (value: number) => {
            this.updateCameraPosition();
            this.saveCameraParamsToMarker();
        });

        // 近裁剪变化
        this.nearClipInput.on('change', (value: number) => {
            if (this.virtualCamera) {
                this.virtualCamera.nearClip = value;
                this.updatePreviewFromParams();
                this.saveCameraParamsToMarker();
            }
        });

        // 远裁剪变化
        this.farClipInput.on('change', (value: number) => {
            if (this.virtualCamera) {
                this.virtualCamera.farClip = value;
                this.updatePreviewFromParams();
                this.saveCameraParamsToMarker();
            }
        });
    }

    // 保存相机参数到marker
    private saveCameraParamsToMarker() {
        if (this.currentMarker) {
            this.currentMarker.cameraParams = this.captureCurrentCameraParams();
            console.log('SnapshotView: Saved camera params to marker:', this.currentMarker.cameraParams);
        }
    }

    // 根据参数更新相机位置和朝向
    private updateCameraPosition() {
        if (!this.currentMarker || !this.virtualCameraEntity) return;

        const markerPosition = this.currentMarker.entity.getPosition();
        const height = this.heightInput.value;
        const pitch = this.pitchInput.value;

        // 设置相机位置（在marker上方指定高度）
        const cameraPosition = markerPosition.clone();
        cameraPosition.y += height;
        this.virtualCameraEntity.setPosition(cameraPosition);

        // 根据俯仰角设置相机朝向
        const pitchRadians = pitch * Math.PI / 180;
        const targetPosition = markerPosition.clone();
        
        // 如果不是完全垂直向下，需要计算目标点
        if (pitch !== -90) {
            const distance = height / Math.tan(-pitchRadians);
            targetPosition.z += distance;
        }

        this.virtualCameraEntity.lookAt(targetPosition);
        
        console.log('SnapshotView: Camera position updated - Height:', height, 'Pitch:', pitch);
        
        // 立即更新预览
        this.updatePreviewFromParams();
    }

    // 从参数更新预览
    private updatePreviewFromParams() {
        if (this.currentMarker) {
            // 保存参数到marker
            this.currentMarker.cameraParams = this.captureCurrentCameraParams();
            // 立即刷新预览
            this.drawPreviewToCanvas();
        }
    }

    // 从marker更新相机参数
    private updateCameraFromMarker() {
        if (!this.currentMarker || !this.virtualCamera) return;

        console.log('SnapshotView: Updating camera from marker position');
        
        // 如果marker有保存的相机参数，则使用保存的参数
        if (this.currentMarker.cameraParams) {
            this.loadCameraParamsFromMarker();
        } else {
            // 否则使用默认参数
            this.resetCameraParamsToDefault();
        }
        
        // 更新相机位置和朝向
        this.updateCameraPosition();
    }

    // 从marker加载相机参数
    private loadCameraParamsFromMarker() {
        const params = this.currentMarker.cameraParams;
        
        // 更新UI控件的值
        this.fovInput.value = params.fov || 75;
        this.heightInput.value = params.height || 2;
        this.pitchInput.value = params.pitch || -90;
        this.nearClipInput.value = params.nearClip || 0.1;
        this.farClipInput.value = params.farClip || 1000;
        
        // 更新虚拟相机参数
        if (this.virtualCamera) {
            this.virtualCamera.fov = this.fovInput.value;
            this.virtualCamera.nearClip = this.nearClipInput.value;
            this.virtualCamera.farClip = this.farClipInput.value;
        }
        
        console.log('SnapshotView: Loaded camera params from marker:', params);
    }

    // 重置相机参数到默认值
    private resetCameraParamsToDefault() {
        this.fovInput.value = 75;
        this.heightInput.value = 2;
        this.pitchInput.value = -90;
        this.nearClipInput.value = 0.1;
        this.farClipInput.value = 1000;
        
        // 更新虚拟相机参数
        if (this.virtualCamera) {
            this.virtualCamera.fov = 75;
            this.virtualCamera.nearClip = 0.1;
            this.virtualCamera.farClip = 1000;
        }
        
        console.log('SnapshotView: Reset camera params to default');
    }

    // 绘制预览到画布
    private drawPreviewToCanvas() {
        // 防止重复渲染
        if (this.isRendering) {
            console.log('SnapshotView: Skipping render - already rendering');
            return;
        }

        // 确保canvas引用正确
        const canvas = this.viewport;
        
        if (!this.virtualCamera || !this.renderTarget || !canvas) {
            console.log('SnapshotView: Missing components for preview rendering');
            console.log('SnapshotView: virtualCamera:', !!this.virtualCamera);
            console.log('SnapshotView: renderTarget:', !!this.renderTarget);
            console.log('SnapshotView: canvas:', !!canvas);
            return;
        }

        this.isRendering = true;
        console.log('SnapshotView: Starting preview rendering');
        
        const device = this.scene.app.graphicsDevice;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
            console.error('SnapshotView: Failed to get 2D context');
            this.isRendering = false;
            return;
        }

        try {
            // 临时启用虚拟相机进行渲染，并设置renderTarget
            this.virtualCamera.enabled = true;
            this.virtualCamera.renderTarget = this.renderTarget;
            console.log('SnapshotView: Virtual camera enabled for rendering');

            // 设置渲染目标
            device.setRenderTarget(this.renderTarget);
            
            // 清除渲染目标 - 使用WebGL上下文直接清除
            const gl = (device as any).gl;
            if (gl) {
                gl.clearColor(0.2, 0.2, 0.2, 1.0);
                gl.clearDepth(1.0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }

            // 手动渲染场景到渲染目标
            this.scene.app.render();
            console.log('SnapshotView: Scene rendered to render target');

            // 使用正确的方法读取像素数据
            const width = this.renderTarget.width;
            const height = this.renderTarget.height;
            const pixels = new Uint8Array(width * height * 4);
            
            // 获取WebGL上下文并直接从framebuffer读取像素
            const glContext = (device as any).gl;
            const renderTargetImpl = (this.renderTarget as any).impl;
            
            if (renderTargetImpl && renderTargetImpl._glFrameBuffer) {
                // 绑定渲染目标的framebuffer
                glContext.bindFramebuffer(glContext.FRAMEBUFFER, renderTargetImpl._glFrameBuffer);
                
                // 检查framebuffer状态
                const status = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER);
                if (status === glContext.FRAMEBUFFER_COMPLETE) {
                    // 读取像素数据
                    glContext.readPixels(0, 0, width, height, glContext.RGBA, glContext.UNSIGNED_BYTE, pixels);
                    console.log('SnapshotView: Pixels read successfully from framebuffer');
                } else {
                    console.error('SnapshotView: Framebuffer not complete, status:', status);
                }
                
                // 恢复默认framebuffer
                glContext.bindFramebuffer(glContext.FRAMEBUFFER, null);
            } else {
                console.error('SnapshotView: Cannot access render target framebuffer');
            }

            device.setRenderTarget(null);

            // 立即禁用虚拟相机
            this.virtualCamera.enabled = false;
            console.log('SnapshotView: Virtual camera disabled');

            // 检查像素数据是否有效
            let hasNonZeroPixels = false;
            let nonZeroCount = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) {
                    hasNonZeroPixels = true;
                    nonZeroCount++;
                }
            }

            console.log('SnapshotView: Has non-zero pixels:', hasNonZeroPixels, 'Count:', nonZeroCount);
            console.log('SnapshotView: Sample pixels:', Array.from(pixels.slice(0, 20)));

            if (!hasNonZeroPixels) {
                console.warn('SnapshotView: All pixels are black, rendering test pattern');
                // 创建测试图案
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const index = (y * width + x) * 4;
                        const checker = ((x >> 4) + (y >> 4)) & 1;
                        pixels[index] = checker ? 255 : 100;     // R
                        pixels[index + 1] = checker ? 100 : 255; // G
                        pixels[index + 2] = 50;                  // B
                        pixels[index + 3] = 255;                 // A
                    }
                }
            }

            // 创建ImageData并翻转Y轴（OpenGL坐标系转换）
            const flippedPixels = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcIndex = ((height - 1 - y) * width + x) * 4;
                    const dstIndex = (y * width + x) * 4;
                    flippedPixels[dstIndex] = pixels[srcIndex];
                    flippedPixels[dstIndex + 1] = pixels[srcIndex + 1];
                    flippedPixels[dstIndex + 2] = pixels[srcIndex + 2];
                    flippedPixels[dstIndex + 3] = pixels[srcIndex + 3];
                }
            }
            
            const imageData = new ImageData(flippedPixels, width, height);
            
            // 调整canvas大小以匹配渲染目标
            canvas.width = width;
            canvas.height = height;
            
            // 绘制图像数据到canvas
            ctx.putImageData(imageData, 0, 0);
            console.log('SnapshotView: Image data drawn to canvas');

        } catch (error) {
            console.error('SnapshotView: Error during preview rendering:', error);
            
            // 确保虚拟相机被禁用并清理renderTarget
            if (this.virtualCamera) {
                this.virtualCamera.enabled = false;
                this.virtualCamera.renderTarget = null;
            }
            
            // 绘制错误指示图案
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText('Render Error', 10, 20);
        } finally {
            // 清理：禁用虚拟相机并移除renderTarget引用
            if (this.virtualCamera) {
                this.virtualCamera.enabled = false;
                this.virtualCamera.renderTarget = null;
            }
            this.isRendering = false;
        }
    }

    // 设置拖拽功能 - 完全参照属性面板实现
    private setupDragging(titleBar: Container) {
        let isDragging = false;
        const dragOffset = { x: 0, y: 0 };
        let dragHandle: HTMLElement | null = null;

        // 使用titleBar的DOM元素作为拖拽句柄
        dragHandle = titleBar.dom as HTMLElement;
        dragHandle.style.cursor = 'move';

        const onPointerDown = (e: PointerEvent) => {
            // 只响应左键点击
            if (e.button !== 0) return;

            // 检查点击的是否是关闭按钮，如果是则不进行拖拽
            const target = e.target as HTMLElement;
            if (target.closest('.panel-header-close')) {
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
            this.dom.style.right = 'auto';
            this.dom.style.bottom = 'auto';

            e.preventDefault();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (isDragging) {
                isDragging = false;
                this.dom.style.zIndex = '100';

                // 释放指针捕获
                if (dragHandle!.hasPointerCapture(e.pointerId)) {
                    dragHandle!.releasePointerCapture(e.pointerId);
                }
            }
        };

        // 绑定事件到拖拽句柄
        dragHandle.addEventListener('pointerdown', onPointerDown);
        dragHandle.addEventListener('pointermove', onPointerMove);
        dragHandle.addEventListener('pointerup', onPointerUp);

        // 处理指针取消事件（例如触摸被中断）
        dragHandle.addEventListener('pointercancel', onPointerUp);

        // 阻止默认的选择行为
        titleBar.dom.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });
    }

    // 显示窗口
    show() {
        this.hidden = false;
        // Rendering is now handled by the 'postrender' event, no need to start it manually.
    }

    // 关闭窗口
    closeWindow() {
        this.events.fire('snapshot.close');
    }

    // 隐藏窗口
    hide() {
        this.hidden = true;
        // Rendering is now handled by the 'postrender' event, it will stop automatically due to the 'this.hidden' check.
    }

    // 关闭面板 - 模拟属性面板的关闭逻辑
    private closePanel() {
        this.hidden = true;
        this.currentMarker = null;
        // Rendering is now handled by the 'postrender' event.
    }

    // 更新marker并调整相机参数
    updateMarker(model: any) {
        this.currentMarker = model;
        this.title.text = `快照预览 - ${model.name || 'Marker'}`;

        // 更新相机参数
        if (model.cameraParams) {
            this.updateCameraFromParams(model.cameraParams);
        } else {
            // 如果没有保存的相机参数，使用marker的位置
            this.updateCameraFromMarker();
        }

        // 手动触发渲染更新
        this.drawPreviewToCanvas();
    }

    // 从参数更新虚拟相机位置
    private updateCameraFromParams(params: any) {
        if (!this.virtualCameraEntity || !params) return;

        try {
            this.virtualCameraEntity.setPosition(params.position.x, params.position.y, params.position.z);
            this.virtualCameraEntity.setEulerAngles(params.rotation.x, params.rotation.y, params.rotation.z);

            if (this.virtualCamera) {
                this.virtualCamera.fov = params.fov || 75;
            }

            // 手动触发渲染更新
            this.drawPreviewToCanvas();
        } catch (error) {
            // 相机参数更新错误静默处理
        }
    }

    // 捕获当前相机参数
    private captureCurrentCameraParams() {
        if (!this.virtualCamera || !this.virtualCameraEntity) return null;

        const position = this.virtualCameraEntity.getPosition();
        const rotation = this.virtualCameraEntity.getRotation();

        return {
            position: { x: position.x, y: position.y, z: position.z },
            rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            fov: this.virtualCamera.fov || 75,
            nearClip: this.virtualCamera.nearClip || 0.1,
            farClip: this.virtualCamera.farClip || 1000,
            // 添加UI控制的参数
            height: this.heightInput?.value || 2,
            pitch: this.pitchInput?.value || -90,
            timestamp: Date.now()
        };
    }

    // 切换可见性
    toggleVisibility() {
        this.hidden = !this.hidden;
        // Rendering is now handled by the 'postrender' event.
    }

    // 销毁资源
    destroy() {
        // 移除渲染事件监听器
        if (this.scene && this.scene.app) {
            this.scene.app.off('postrender', this.drawPreviewToCanvas, this);
        }

        if (this.virtualCameraEntity) {
            this.virtualCameraEntity.destroy();
            this.virtualCameraEntity = null;
            this.virtualCamera = null;
        }

        if (this.renderTarget) {
            this.renderTarget.destroy();
            this.renderTarget = null;
        }

        // 清理拖拽事件监听器 - 现在使用pointer事件，不需要额外清理

        super.destroy();
    }
}
