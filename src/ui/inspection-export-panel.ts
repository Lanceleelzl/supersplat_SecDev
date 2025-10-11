import { Container, Label, Button, BooleanInput } from '@playcanvas/pcui';
import { Events } from '../events';

interface ExportOptions {
    pointName: boolean;
    markerName: boolean;
    coordinateX: boolean;
    coordinateY: boolean;
    coordinateZ: boolean;
    height: boolean;
    gimbalPitch: boolean;
    gimbalYaw: boolean;
}

class InspectionExportPanel extends Container {
    private events: Events;
    private exportOptions: ExportOptions;
    private checkboxes: { [key: string]: BooleanInput } = {};
    private isDragging: boolean = false;
    private dragOffset: { x: number; y: number } = { x: 0, y: 0 };

    constructor(events: Events, args = {}) {
        args = {
            ...args,
            class: ['panel', 'inspection-export-panel']
        };

        super(args);
        this.events = events;

        // 默认隐藏面板
        this.hidden = true;

        // 默认导出选项
        this.exportOptions = {
            pointName: true,
            markerName: true,
            coordinateX: true,
            coordinateY: true,
            coordinateZ: true,
            height: true,
            gimbalPitch: false,
            gimbalYaw: false
        };

        this.createUI();
        this.setupEvents();
        this.setupDragFunctionality();
    }

    private createUI() {
        // 创建标题栏 - 参照属性面板实现
        const header = new Container({
            class: 'panel-header'
        });

        const headerIcon = new Label({
            text: '\uE111',
            class: 'panel-header-icon'
        });

        const headerLabel = new Label({
            text: '导出巡检参数',
            class: 'panel-header-label'
        });

        header.append(headerIcon);
        header.append(headerLabel);

        // 创建内容容器
        const contentContainer = new Container({
            class: 'inspection-export-content'
        });

        // 说明文本
        const description = new Label({
            text: '请选择要导出的巡检参数：',
            class: 'export-description'
        });
        contentContainer.append(description);

        // 创建选项容器
        const optionsContainer = new Container({
            class: 'export-options-container'
        });

        // 创建各个选项
        const options = [
            { key: 'pointName', label: '巡检点位名称', description: '如：XJ-1, XJ-2' },
            { key: 'markerName', label: '下属编号名称', description: '如：XJ-1-1, XJ-1-2' },
            { key: 'coordinateX', label: 'X坐标', description: '模型在X轴的位置坐标' },
            { key: 'coordinateY', label: 'Y坐标', description: '模型在Y轴的位置坐标' },
            { key: 'coordinateZ', label: 'Z坐标', description: '模型在Z轴的位置坐标' },
            { key: 'height', label: '高度信息', description: '模型的Y轴坐标值' },
            { key: 'gimbalPitch', label: '云台俯仰', description: '云台俯仰角度（Pitch）' },
            { key: 'gimbalYaw', label: '云台方向', description: '云台方向角度（Yaw）' }
        ];

        options.forEach(option => {
            const optionContainer = new Container({
                class: 'export-option-row'
            });

            // 创建复选框
            const checkbox = new BooleanInput({
                value: this.exportOptions[option.key as keyof ExportOptions],
                class: 'export-checkbox'
            });
            this.checkboxes[option.key] = checkbox;

            // 创建标签
            const label = new Label({
                text: option.label,
                class: 'export-option-label'
            });

            optionContainer.append(checkbox);
            optionContainer.append(label);
            optionsContainer.append(optionContainer);

            // 绑定事件
            checkbox.on('change', (value: boolean) => {
                this.exportOptions[option.key as keyof ExportOptions] = value;
            });
        });

        contentContainer.append(optionsContainer);

        // 创建按钮容器
        const buttonContainer = new Container({
            class: 'export-button-container'
        });

        // 全选按钮
        const selectAllButton = new Button({
            text: '全选',
            class: 'export-select-all'
        });

        // 全不选按钮
        const deselectAllButton = new Button({
            text: '全不选',
            class: 'export-select-none'
        });

        // 导出按钮
        const exportButton = new Button({
            text: '导出Excel',
            class: 'export-confirm'
        });

        // 取消按钮
        const cancelButton = new Button({
            text: '取消',
            class: 'export-cancel'
        });

        buttonContainer.append(selectAllButton);
        buttonContainer.append(deselectAllButton);
        buttonContainer.append(exportButton);
        buttonContainer.append(cancelButton);

        contentContainer.append(buttonContainer);

        // 将标题栏和内容添加到面板
        this.append(header);
        this.append(contentContainer)

        // 绑定按钮事件
        selectAllButton.on('click', () => this.selectAll(true));
        deselectAllButton.on('click', () => this.selectAll(false));
        exportButton.on('click', () => this.handleExport());
        cancelButton.on('click', () => this.hide());
    }

    private setupEvents() {
        // 监听导出事件
        this.events.on('inspection.showExportPanel', () => {
            this.show();
        });

        // 阻止事件冒泡
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });
    }

    private setupDragFunctionality() {
        const header = this.dom.querySelector('.panel-header') as HTMLElement;
        if (!header) return;

        // 添加拖动样式
        header.style.cursor = 'move';
        header.style.userSelect = 'none';

        let isDragging = false;
        const dragOffset = { x: 0, y: 0 };

        const onPointerDown = (e: PointerEvent) => {
            // 只响应左键点击
            if (e.button !== 0) return;

            isDragging = true;
            const rect = this.dom.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;

            // 设置面板为绝对定位
            this.dom.style.position = 'absolute';
            this.dom.style.zIndex = '1000';

            // 捕获指针，确保鼠标移出元素时仍能响应事件
            header.setPointerCapture(e.pointerId);

            e.preventDefault();
            e.stopPropagation();
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!isDragging) return;

            const newX = e.clientX - dragOffset.x;
            const newY = e.clientY - dragOffset.y;

            // 限制在视窗范围内
            const maxX = window.innerWidth - this.dom.offsetWidth;
            const maxY = window.innerHeight - this.dom.offsetHeight;

            const clampedX = Math.max(0, Math.min(newX, maxX));
            const clampedY = Math.max(0, Math.min(newY, maxY));

            // 更新位置
            this.dom.style.left = clampedX + 'px';
            this.dom.style.top = clampedY + 'px';
            this.dom.style.transform = 'none'; // 取消居中变换

            e.preventDefault();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!isDragging) return;

            isDragging = false;
            header.releasePointerCapture(e.pointerId);

            e.preventDefault();
        };

        // 绑定事件到拖拽句柄
        header.addEventListener('pointerdown', onPointerDown);
        header.addEventListener('pointermove', onPointerMove);
        header.addEventListener('pointerup', onPointerUp);

        // 处理指针取消事件（例如触摸被中断）
        header.addEventListener('pointercancel', onPointerUp);
    }

    private selectAll(value: boolean) {
        Object.keys(this.checkboxes).forEach(key => {
            this.checkboxes[key].value = value;
            this.exportOptions[key as keyof ExportOptions] = value;
        });
    }

    private handleExport() {
        // 检查是否至少选择了一个选项
        const hasSelection = Object.values(this.exportOptions).some(value => value);
        
        if (!hasSelection) {
            alert('请至少选择一个导出参数！');
            return;
        }

        // 触发导出事件，传递选择的选项
        this.events.fire('inspection.doExport', this.exportOptions);
        this.hide();
    }

    show() {
        this.hidden = false;
        this.dom.classList.add('visible');
        
        // 强制设置样式确保浮动定位
        this.dom.style.position = 'fixed';
        this.dom.style.top = '50%';
        this.dom.style.left = '50%';
        this.dom.style.transform = 'translate(-50%, -50%)';
        this.dom.style.zIndex = '10000';
        this.dom.style.margin = '0';
        this.dom.style.padding = '0';
        
        // 阻止背景滚动
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.hidden = true;
        this.dom.classList.remove('visible');
        
        // 恢复背景滚动
        document.body.style.overflow = '';
    }
}

export { InspectionExportPanel, ExportOptions };