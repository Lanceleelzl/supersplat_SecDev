import { Container, Label, Button, Element } from '@playcanvas/pcui';
import { Entity, RenderTarget, Texture, Vec3, PIXELFORMAT_RGBA8, FILTER_LINEAR } from 'playcanvas';

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

        this.append(titleBar);
        this.append(this.viewport);

        // 初始化虚拟相机
        this.initVirtualCamera();

        // 监听marker选择事件 - 统一由main.ts中的marker.selected事件处理
        this.events.on('marker.selected', (model: any) => {
            if (model && (model as any).isInspectionModel) {
                console.log('Marker selected in snapshot view:', model);
                this.currentMarker = model;
                this.updateCameraFromMarker();
            }
        });

        // 监听marker位置变化
        this.events.on('marker.transform', (marker) => {
            if (this.currentMarker === marker) {
                this.updateCameraFromMarker();
            }
        });

        // 监听快照窗口显示/隐藏事件
        this.events.on('snapshot.show', () => {
            this.hidden = false;
            this.startRendering();
        });

        this.events.on('snapshot.hide', () => {
            this.hidden = true;
            this.stopRendering();
        });

        // 关闭按钮事件 - 强制阻止事件穿透
        closeBtn.dom.addEventListener('click', (e) => {
            console.log('Snapshot close button clicked');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            // 直接隐藏面板，不触发toggle事件
            this.closePanel();
            return false;
        }, true);  // 使用捕获阶段

        // 也监听mousedown和pointerdown事件来完全阻止穿透
        closeBtn.dom.addEventListener('mousedown', (e) => {
            console.log('Snapshot close button mousedown');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }, true);

        closeBtn.dom.addEventListener('pointerdown', (e) => {
            console.log('Snapshot close button pointerdown');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }, true);

        // 添加拖拽功能
        this.setupDragging(titleBar);

        // 开始渲染循环
        this.startRendering();
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
            clearColor: [0.1, 0.1, 0.1, 1]
        });

        // 创建渲染目标
        const device = this.scene.app.graphicsDevice;
        this.renderTarget = new RenderTarget({
            colorBuffer: new Texture(device, {
                width: 320,
                height: 180,
                format: PIXELFORMAT_RGBA8,
                minFilter: FILTER_LINEAR,
                magFilter: FILTER_LINEAR
            }),
            depth: true
        });

        this.virtualCamera.renderTarget = this.renderTarget;

        // 添加到场景但不渲染到主视口
        this.scene.app.root.addChild(this.virtualCameraEntity);

        // 设置初始位置
        this.virtualCameraEntity.setPosition(0, 5, 10);
        this.virtualCameraEntity.lookAt(0, 0, 0);
    }

    // 从marker更新相机参数
    private updateCameraFromMarker() {
        if (!this.currentMarker || !this.virtualCameraEntity) return;

        const markerEntity = this.currentMarker.entity;
        if (!markerEntity) return;

        // 获取marker的世界变换
        const position = markerEntity.getPosition().clone();
        const rotation = markerEntity.getRotation().clone();

        // 设置相机位置（稍微偏移以获得更好的视角）
        const offset = new Vec3(0, 2, 5); // 相机偏移量
        const rotatedOffset = new Vec3();
        rotation.transformVector(offset, rotatedOffset);
        position.add(rotatedOffset);

        this.virtualCameraEntity.setPosition(position);
        this.virtualCameraEntity.setRotation(rotation);

        // 保存相机参数到marker对象中，供后续导出使用
        (this.currentMarker as any).cameraParams = {
            position: { x: position.x, y: position.y, z: position.z },
            rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            fov: this.virtualCamera?.fov || 75,
            nearClip: this.virtualCamera?.nearClip || 0.1,
            farClip: this.virtualCamera?.farClip || 1000,
            timestamp: Date.now()
        };

        console.log(`更新快照相机位置: ${position.x}, ${position.y}, ${position.z}`);
        console.log('相机参数已保存到marker:', (this.currentMarker as any).cameraParams);
    }

    // 开始渲染循环
    startRendering() {
        if (this.isRendering) return;
        this.isRendering = true;
        this.renderLoop();
    }

    // 停止渲染循环
    private stopRendering() {
        this.isRendering = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = 0;
        }
    }

    // 渲染循环
    private renderLoop = () => {
        if (!this.isRendering) return;

        this.renderToCanvas();
        this.animationId = requestAnimationFrame(this.renderLoop);
    };

    // 渲染到canvas
    private renderToCanvas() {
        if (!this.virtualCamera || !this.renderTarget || !this.viewport) return;

        try {
            // 设置渲染目标
            this.virtualCamera.renderTarget = this.renderTarget;

            // 触发场景渲染
            this.scene.forceRender = true;

            // 将渲染结果复制到canvas
            const ctx = this.viewport.getContext('2d');
            if (ctx) {
                // 这里需要从WebGL纹理读取像素数据到canvas
                // 由于PlayCanvas的限制，这里使用简化的预览
                this.drawPreview(ctx);
            }
        } catch (error) {
            console.warn('快照窗口渲染错误:', error);
        }
    }

    // 绘制预览（临时实现）
    private drawPreview(ctx: CanvasRenderingContext2D) {
        ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

        // 背景
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

        if (this.currentMarker) {
            // 绘制相机信息
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px monospace';

            const markerName = (this.currentMarker as any).inspectionMarkerName || 'Unknown';
            const position = this.virtualCameraEntity?.getPosition();
            const rotation = this.virtualCameraEntity?.getRotation();

            ctx.fillText(`Marker: ${markerName}`, 10, 20);
            if (position) {
                ctx.fillText(`位置: ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`, 10, 40);
            }
            if (rotation) {
                const euler = rotation.getEulerAngles();
                ctx.fillText(`角度: ${euler.x.toFixed(1)}°, ${euler.y.toFixed(1)}°, ${euler.z.toFixed(1)}°`, 10, 60);
            }

            // 绘制简单的场景表示
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 2;
            ctx.strokeRect(10, 80, this.viewport.width - 20, this.viewport.height - 100);

            ctx.fillStyle = '#4CAF50';
            ctx.fillText('实时预览窗口', this.viewport.width / 2 - 40, this.viewport.height / 2);
        } else {
            ctx.fillStyle = '#888888';
            ctx.font = '14px sans-serif';
            ctx.fillText('请选择一个巡检点位', this.viewport.width / 2 - 60, this.viewport.height / 2);
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
        this.startRendering();
    }

    // 关闭窗口
    closeWindow() {
        this.events.fire('snapshot.close');
    }

    // 隐藏窗口
    hide() {
        this.hidden = true;
        this.stopRendering();
    }

    // 关闭面板 - 模拟属性面板的关闭逻辑
    private closePanel() {
        console.log('Closing snapshot panel');
        this.hidden = true;
        this.stopRendering();
        this.currentMarker = null;
    }

    // 更新marker并调整相机参数
    updateMarker(model: any) {
        console.log('Updating marker in snapshot view:', model);
        this.currentMarker = model;
        this.title.text = `快照预览 - ${model.name || 'Marker'}`;

        // 更新相机参数
        if (model.cameraParams) {
            console.log('Using saved camera params:', model.cameraParams);
            this.updateCameraFromParams(model.cameraParams);
        } else {
            // 如果没有保存的相机参数，使用当前相机位置
            console.log('Capturing current camera params');
            this.captureCurrentCameraParams();
        }

        // 确保重新渲染
        this.renderToCanvas();
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
        } catch (error) {
            console.error('Error updating camera from params:', error);
        }
    }

    // 捕获当前相机参数
    private captureCurrentCameraParams() {
        if (!this.scene || !this.scene.camera || !this.virtualCameraEntity) return;

        const mainCamera = this.scene.camera;
        const position = mainCamera.entity.getPosition();
        const rotation = mainCamera.entity.getEulerAngles();

        this.virtualCameraEntity.setPosition(position.x, position.y, position.z);
        this.virtualCameraEntity.setEulerAngles(rotation.x, rotation.y, rotation.z);

        if (this.virtualCamera) {
            this.virtualCamera.fov = mainCamera.fov;
        }
    }

    // 切换可见性
    toggleVisibility() {
        if (this.hidden) {
            this.show();
        } else {
            this.hidden = true;
            this.stopRendering();
        }
    }

    // 销毁资源
    destroy() {
        this.stopRendering();

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
