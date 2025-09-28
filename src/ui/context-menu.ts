import { Container, Element } from '@playcanvas/pcui';

import { ElementType } from '../element';
import { Events } from '../events';
import { GltfModel } from '../gltf-model';
import { localize } from './localization';

interface ContextMenuItem {
    text: string;
    icon?: string;
    action: () => void;
    enabled?: () => boolean;
}

class ContextMenu extends Container {
    private events: Events;
    private isVisible: boolean = false;
    private currentModel: GltfModel | null = null;
    private menuItems: ContextMenuItem[] = [];

    constructor(events: Events) {
        super({
            class: 'context-menu',
            hidden: true
        });

        this.events = events;
        this.setupMenuItems();
        this.bindEvents();
        this.createMenuDOM();

        // 添加到document.body以确保菜单可以覆盖其他元素
        document.body.appendChild(this.dom);
    }

    private setupMenuItems() {
        this.menuItems = [
            {
                text: '原位复制',
                icon: '📋',
                action: () => this.duplicateInPlace(),
                enabled: () => this.currentModel !== null
            },
            {
                text: '删除模型',
                icon: '🗑️',
                action: () => this.deleteModel(),
                enabled: () => this.currentModel !== null
            },
            {
                text: '隐藏模型',
                icon: '👁️',
                action: () => this.hideModel(),
                enabled: () => this.currentModel !== null && this.currentModel.entity?.enabled
            },
            {
                text: '显示模型',
                icon: '👁️‍🗨️',
                action: () => this.showModel(),
                enabled: () => this.currentModel !== null && !this.currentModel.entity?.enabled
            }
        ];
    }

    private createMenuDOM() {
        this.dom.style.position = 'fixed';
        this.dom.style.backgroundColor = '#2a2a2a';
        this.dom.style.border = '1px solid #555';
        this.dom.style.borderRadius = '4px';
        this.dom.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        this.dom.style.zIndex = '10000';
        this.dom.style.minWidth = '150px';
        this.dom.style.padding = '4px 0';

        this.menuItems.forEach((item, index) => {
            const menuItem = new Element({
                class: 'context-menu-item'
            });

            menuItem.dom.style.padding = '8px 16px';
            menuItem.dom.style.cursor = 'pointer';
            menuItem.dom.style.display = 'flex';
            menuItem.dom.style.alignItems = 'center';
            menuItem.dom.style.fontSize = '13px';
            menuItem.dom.style.color = '#ffffff';
            menuItem.dom.style.userSelect = 'none';

            const icon = document.createElement('span');
            icon.textContent = item.icon || '';
            icon.style.marginRight = '8px';
            icon.style.fontSize = '14px';

            const text = document.createElement('span');
            text.textContent = item.text;

            menuItem.dom.appendChild(icon);
            menuItem.dom.appendChild(text);

            // 鼠标悬停效果
            menuItem.dom.addEventListener('mouseenter', () => {
                if (item.enabled ? item.enabled() : true) {
                    menuItem.dom.style.backgroundColor = '#4a4a4a';
                }
            });

            menuItem.dom.addEventListener('mouseleave', () => {
                menuItem.dom.style.backgroundColor = 'transparent';
            });

            // 点击事件
            menuItem.dom.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (item.enabled ? item.enabled() : true) {
                    item.action();
                    this.hide();
                }
            });

            this.append(menuItem);
        });
    }

    private bindEvents() {
        // 监听鼠标右键事件
        document.addEventListener('contextmenu', (e) => {
            // 检查是否在画布区域右键
            const canvas = document.querySelector('canvas');
            if (canvas && canvas.contains(e.target as Node)) {
                e.preventDefault();

                // 获取当前选中的模型
                const selection = this.events.invoke('selection');
                if (selection && selection.type === ElementType.model) {
                    this.currentModel = selection as GltfModel;
                    this.show(e.clientX, e.clientY);
                } else {
                    this.hide();
                }
            } else {
                this.hide();
            }
        });

        // 点击其他地方隐藏菜单
        document.addEventListener('click', (e) => {
            if (!this.dom.contains(e.target as Node)) {
                this.hide();
            }
        });

        // ESC键隐藏菜单
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });

        // 监听选择变化，如果没有选中模型则隐藏菜单
        this.events.on('selection.changed', (element: any) => {
            if (!element || element.type !== ElementType.model) {
                this.currentModel = null;
                this.hide();
            } else {
                this.currentModel = element as GltfModel;
            }
        });
    }

    private show(x: number, y: number) {
        if (this.isVisible) return;

        this.isVisible = true;
        this.hidden = false;

        // 更新菜单项状态
        this.updateMenuItemStates();

        // 设置位置，确保菜单不会超出屏幕边界
        const rect = this.dom.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 10;
        const maxY = window.innerHeight - rect.height - 10;

        const finalX = Math.min(x, maxX);
        const finalY = Math.min(y, maxY);

        this.dom.style.left = `${finalX}px`;
        this.dom.style.top = `${finalY}px`;
    }

    private hide() {
        if (!this.isVisible) return;

        this.isVisible = false;
        this.hidden = true;
    }

    private updateMenuItemStates() {
        const items = this.dom.querySelectorAll('.context-menu-item');
        items.forEach((item, index) => {
            const menuItem = this.menuItems[index];
            const isEnabled = menuItem.enabled ? menuItem.enabled() : true;

            if (isEnabled) {
                item.classList.remove('disabled');
                (item as HTMLElement).style.opacity = '1';
                (item as HTMLElement).style.cursor = 'pointer';
            } else {
                item.classList.add('disabled');
                (item as HTMLElement).style.opacity = '0.5';
                (item as HTMLElement).style.cursor = 'not-allowed';
            }
        });
    }

    private duplicateInPlace() {
        if (!this.currentModel) return;

        try {
            console.log('开始原位复制GLB模型:', this.currentModel.filename);

            // 触发复制事件并等待完成
            this.duplicateGltfModel(this.currentModel);

            console.log('原位复制请求已发送');

        } catch (error) {
            console.error('原位复制失败:', error);
        }
    }

    private duplicateGltfModel(model: GltfModel) {
        // 触发GLB模型复制事件
        try {
            console.log('触发GLB模型复制事件:', model.filename);

            // 触发复制事件，编辑器会处理具体的复制逻辑
            this.events.fire('model.duplicate', model);

        } catch (error) {
            console.error('复制GLB模型失败:', error);
            throw error;
        }
    }

    private deleteModel() {
        if (!this.currentModel) return;

        try {
            // 触发删除事件
            const scene = this.events.invoke('scene');
            if (scene) {
                scene.remove(this.currentModel);
                console.log('模型删除成功');
            }
        } catch (error) {
            console.error('删除模型失败:', error);
        }
    }

    private hideModel() {
        if (!this.currentModel || !this.currentModel.entity) return;

        try {
            this.currentModel.entity.enabled = false;
            this.events.fire('model.visibility', this.currentModel);
            console.log('模型已隐藏');
        } catch (error) {
            console.error('隐藏模型失败:', error);
        }
    }

    private showModel() {
        if (!this.currentModel || !this.currentModel.entity) return;

        try {
            this.currentModel.entity.enabled = true;
            this.events.fire('model.visibility', this.currentModel);
            console.log('模型已显示');
        } catch (error) {
            console.error('显示模型失败:', error);
        }
    }
}

export { ContextMenu };
