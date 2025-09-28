import { Container, Label, Element } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { ElementType } from '../element';
import { Events } from '../events';
import { GltfModel } from '../gltf-model';
import { localize } from './localization';
import closeSvg from './svg/close.svg';
import { Tooltips } from './tooltips';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

// 属性面板类，显示选中GLB模型的详细信息
class PropertiesPanel extends Container {
    events: Events;
    tooltips: Tooltips;
    currentModel: GltfModel | null = null;

    // 信息显示容器
    infoContainer: Container;
    placeholder: Label;
    nameLabel: Label;
    typeLabel: Label;

    // 几何信息标签
    boundingBoxLabel: Label;
    verticesLabel: Label;
    facesLabel: Label;

    // 变换信息标签
    positionLabel: Label;
    rotationLabel: Label;
    scaleLabel: Label;

    // 可折叠容器和标题
    basicInfoHeader: Label;
    geometryHeader: Label;
    transformHeader: Label;
    basicInfoContainer: Container;
    geometryContainer: Container;
    transformContainer: Container;

    // 折叠状态
    private basicInfoCollapsed: boolean = false;
    private geometryCollapsed: boolean = false;
    private transformCollapsed: boolean = false;

    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'properties-panel',
            class: 'panel'
        };

        super(args);

        this.events = events;
        this.tooltips = tooltips;

        // stop pointer events bubbling
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        this.createUI();
        this.bindEvents();

        // 添加拖拽功能
        this.addDragFunctionality();
    }

    private createUI() {
        // 面板头部
        const propertiesHeader = new Container({
            class: 'panel-header'
        });

        const propertiesIcon = new Label({
            text: '\uE30A', // 属性图标
            class: 'panel-header-icon'
        });

        const propertiesLabel = new Label({
            text: '属性',
            class: 'panel-header-label'
        });

        // 关闭按钮
        const closeButton = new Element({
            class: 'panel-header-close'
        });
        closeButton.dom.appendChild(createSvg(closeSvg));

        // 关闭按钮点击事件
        closeButton.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closePanel();
        });

        propertiesHeader.append(propertiesIcon);
        propertiesHeader.append(propertiesLabel);
        propertiesHeader.append(closeButton);

        // 主信息容器
        this.infoContainer = new Container({
            class: 'properties-info-container'
        });

        // 基本信息section
        this.basicInfoHeader = new Label({
            text: '▼ 基本信息',
            class: 'collapsible-header'
        });

        this.basicInfoContainer = new Container({
            class: 'collapsible-content'
        });

        this.nameLabel = new Label({
            text: '名称: -',
            class: 'properties-info-label'
        });

        this.typeLabel = new Label({
            text: '类型: -',
            class: 'properties-info-label'
        });

        // 将基本信息标签添加到容器
        this.basicInfoContainer.append(this.nameLabel);
        this.basicInfoContainer.append(this.typeLabel);

        // 几何信息section
        this.geometryHeader = new Label({
            text: '▼ 几何信息',
            class: 'collapsible-header'
        });

        this.geometryContainer = new Container({
            class: 'collapsible-content'
        });

        this.boundingBoxLabel = new Label({
            text: '包围盒: -',
            class: 'properties-info-label'
        });

        this.verticesLabel = new Label({
            text: '顶点数: -',
            class: 'properties-info-label'
        });

        this.facesLabel = new Label({
            text: '面数: -',
            class: 'properties-info-label'
        });

        // 将几何信息标签添加到容器
        this.geometryContainer.append(this.boundingBoxLabel);
        this.geometryContainer.append(this.verticesLabel);
        this.geometryContainer.append(this.facesLabel);

        // 变换信息section
        this.transformHeader = new Label({
            text: '▼ 变换信息',
            class: 'collapsible-header'
        });

        this.transformContainer = new Container({
            class: 'collapsible-content'
        });

        this.positionLabel = new Label({
            text: '位置: -',
            class: 'properties-info-label'
        });

        this.rotationLabel = new Label({
            text: '旋转: -',
            class: 'properties-info-label'
        });

        this.scaleLabel = new Label({
            text: '缩放: -',
            class: 'properties-info-label'
        });

        // 将变换信息标签添加到容器
        this.transformContainer.append(this.positionLabel);
        this.transformContainer.append(this.rotationLabel);
        this.transformContainer.append(this.scaleLabel);

        // 添加点击事件处理
        this.addCollapsibleEvents();

        // 添加所有元素到容器
        // 基本信息部分
        this.infoContainer.append(this.basicInfoHeader);
        this.infoContainer.append(this.basicInfoContainer);

        this.infoContainer.append(new Container({ class: 'properties-spacer' }));

        // 几何信息部分
        this.infoContainer.append(this.geometryHeader);
        this.infoContainer.append(this.geometryContainer);

        this.infoContainer.append(new Container({ class: 'properties-spacer' }));

        // 变换信息部分
        this.infoContainer.append(this.transformHeader);
        this.infoContainer.append(this.transformContainer);

        // 占位符，当没有选中模型时显示
        this.placeholder = new Label({
            text: '选择一个GLB模型以查看属性',
            class: 'properties-placeholder'
        });

        this.append(propertiesHeader);
        this.append(this.placeholder);
        this.append(this.infoContainer);

        // 初始状态：隐藏整个面板，只有选中GLB模型时才显示
        this.hidden = true;
        this.infoContainer.hidden = true;
    }

    private bindEvents() {
        // 监听选择变化事件（当选择不同元素时）
        this.events.on('selection.changed', (element: any) => {
            if (element && element.type === ElementType.model) {
                const model = element as GltfModel;
                this.showPanel();
                this.showModelProperties(model);
            } else {
                this.hideProperties();
            }
        });

        // 监听相机焦点拾取事件（这个事件在每次点击时都会触发，包括点击同一个模型）
        this.events.on('camera.focalPointPicked', (details: { splat?: any, model?: GltfModel }) => {
            if (details.model && details.model.type === ElementType.model) {
                // 如果面板隐藏了，重新显示
                if (this.hidden) {
                    this.showPanel();
                    this.showModelProperties(details.model);
                }
            }
        });

        // 监听元素删除事件，防止访问已删除的模型引用
        this.events.on('scene.elementRemoved', (element: any) => {
            if (this.currentModel && element === this.currentModel) {
                // 当前显示的模型被删除，清理引用并隐藏面板
                this.hideProperties();
            }
        });
    }

    // 显示面板
    private showPanel() {
        this.hidden = false;
    }

    // 关闭面板
    private closePanel() {
        this.hidden = true;
        this.currentModel = null;
    }

    private showModelProperties(model: GltfModel) {
        this.currentModel = model;
        this.placeholder.hidden = true;
        this.infoContainer.hidden = false;
        this.updateModelInfo();
    }

    private hideProperties() {
        this.currentModel = null;
        this.placeholder.hidden = false;
        this.infoContainer.hidden = true;
        this.clearLabels();
    }

    private updateModelInfo() {
        if (!this.currentModel) {
            this.clearLabels();
            return;
        }

        const model = this.currentModel;

        // 检查模型和实体是否仍然有效（防止访问已删除的对象）
        if (!model.entity || !model.entity.enabled) {
            this.hideProperties();
            return;
        }

        try {
            // 基本信息
            this.nameLabel.text = `名称: ${model.filename || '未知'}`;
            this.typeLabel.text = '类型: GLB/glTF 模型';

            // 几何信息
            this.updateGeometryInfo(model);

            // 变换信息
            this.updateTransformInfo(model);
        } catch (error) {
            // 如果访问模型数据时出现错误，说明模型可能已被删除
            console.warn('属性面板更新时出错，可能模型已被删除:', error);
            this.hideProperties();
        }
    }

    private updateGeometryInfo(model: GltfModel) {
        try {
            // 包围盒信息
            const bound = model.worldBound;
            if (bound) {
                const size = new Vec3().copy(bound.halfExtents).mulScalar(2);
                this.boundingBoxLabel.text = `包围盒: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
            } else {
                this.boundingBoxLabel.text = '包围盒: 无法计算';
            }

            // 统计顶点和面数
            let totalVertices = 0;
            let totalFaces = 0;

            if (model.entity && model.entity.enabled) {
                this.countMeshData(model.entity, (vertices, faces) => {
                    totalVertices += vertices;
                    totalFaces += faces;
                });
            }

            this.verticesLabel.text = `顶点数: ${totalVertices.toLocaleString()}`;
            this.facesLabel.text = `面数: ${totalFaces.toLocaleString()}`;
        } catch (error) {
            // 如果计算几何信息时出错，显示错误状态
            this.boundingBoxLabel.text = '包围盒: 计算错误';
            this.verticesLabel.text = '顶点数: 计算错误';
            this.facesLabel.text = '面数: 计算错误';
        }
    }

    private updateTransformInfo(model: GltfModel) {
        if (!model.entity || !model.entity.enabled) {
            this.positionLabel.text = '位置: -';
            this.rotationLabel.text = '旋转: -';
            this.scaleLabel.text = '缩放: -';
            return;
        }

        try {
            const entity = model.entity;
            const pos = entity.getPosition();
            const rot = entity.getRotation();
            const scale = entity.getLocalScale();

            // 位置信息
            this.positionLabel.text = `位置: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`;

            // 旋转信息 (转换为欧拉角显示)
            const euler = rot.getEulerAngles();
            this.rotationLabel.text = `旋转: (${euler.x.toFixed(1)}°, ${euler.y.toFixed(1)}°, ${euler.z.toFixed(1)}°)`;

            // 缩放信息
            this.scaleLabel.text = `缩放: (${scale.x.toFixed(3)}, ${scale.y.toFixed(3)}, ${scale.z.toFixed(3)})`;
        } catch (error) {
            // 如果获取变换信息时出错，显示错误状态
            this.positionLabel.text = '位置: 获取失败';
            this.rotationLabel.text = '旋转: 获取失败';
            this.scaleLabel.text = '缩放: 获取失败';
        }
    }

    private countMeshData(entity: any, callback: (vertices: number, faces: number) => void) {
        if (!entity || !entity.enabled) {
            return;
        }

        try {
            // 统计当前实体的mesh数据
            if (entity.render && entity.render.meshInstances) {
                entity.render.meshInstances.forEach((meshInstance: any) => {
                    // 检查meshInstance是否有效且不为null
                    if (meshInstance && meshInstance.mesh) {
                        const mesh = meshInstance.mesh;
                        const vertices = mesh.vertexBuffer ? mesh.vertexBuffer.numVertices : 0;
                        const indices = mesh.indexBuffer ? mesh.indexBuffer.numIndices : vertices;
                        const faces = Math.floor(indices / 3);
                        callback(vertices, faces);
                    }
                });
            }

            // 递归处理子实体
            if (entity.children && entity.children.length > 0) {
                entity.children.forEach((child: any) => {
                    this.countMeshData(child, callback);
                });
            }
        } catch (error) {
            // 忽略统计过程中的错误，避免阻塞UI更新
            console.warn('统计网格数据时出错:', error);
        }
    }

    private clearLabels() {
        this.nameLabel.text = '名称: -';
        this.typeLabel.text = '类型: -';
        this.boundingBoxLabel.text = '包围盒: -';
        this.verticesLabel.text = '顶点数: -';
        this.facesLabel.text = '面数: -';
        this.positionLabel.text = '位置: -';
        this.rotationLabel.text = '旋转: -';
        this.scaleLabel.text = '缩放: -';
    }

    private addDragFunctionality() {
        let isDragging = false;
        const dragOffset = { x: 0, y: 0 };
        let dragHandle: HTMLElement | null = null;

        // 找到面板头部作为拖拽句柄
        const headerElements = this.dom.querySelectorAll('.panel-header');
        if (headerElements.length > 0) {
            dragHandle = headerElements[0] as HTMLElement;
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
        }
    }

    private addCollapsibleEvents() {
        // 基本信息点击事件
        this.basicInfoHeader.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleBasicInfo();
        });

        // 几何信息点击事件
        this.geometryHeader.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleGeometry();
        });

        // 变换信息点击事件
        this.transformHeader.dom.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleTransform();
        });
    }

    private toggleBasicInfo() {
        this.basicInfoCollapsed = !this.basicInfoCollapsed;
        this.basicInfoContainer.hidden = this.basicInfoCollapsed;
        this.basicInfoHeader.text = this.basicInfoCollapsed ? '▶ 基本信息' : '▼ 基本信息';
    }

    private toggleGeometry() {
        this.geometryCollapsed = !this.geometryCollapsed;
        this.geometryContainer.hidden = this.geometryCollapsed;
        this.geometryHeader.text = this.geometryCollapsed ? '▶ 几何信息' : '▼ 几何信息';
    }

    private toggleTransform() {
        this.transformCollapsed = !this.transformCollapsed;
        this.transformContainer.hidden = this.transformCollapsed;
        this.transformHeader.text = this.transformCollapsed ? '▶ 变换信息' : '▼ 变换信息';
    }
}

export { PropertiesPanel };
