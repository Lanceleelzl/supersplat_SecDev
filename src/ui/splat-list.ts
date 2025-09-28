import { Container, Label, Element as PcuiElement, TextInput } from '@playcanvas/pcui';

import { SplatRenameOp, GltfModelRenameOp } from '../edit-ops';
import { Element, ElementType } from '../element';
import { Events } from '../events';
import { GltfModel } from '../gltf-model';
import { Splat } from '../splat';
import collapseSvg from './svg/collapse.svg';
import deleteSvg from './svg/delete.svg';
import hiddenSvg from './svg/hidden.svg';
import selectDuplicateSvg from './svg/select-duplicate.svg';
import shownSvg from './svg/shown.svg';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class CategoryContainer extends Container {
    private _collapsed: boolean = false;
    private headerElement: Container;
    private contentContainer: Container;
    private collapseIcon: PcuiElement;
    private categoryLabel: Label;

    constructor(title: string, args = {}) {
        args = {
            ...args,
            class: ['category-container']
        };
        super(args);

        // 创建标题头部
        this.headerElement = new Container({
            class: 'category-header'
        });

        // 创建折叠图标
        this.collapseIcon = new PcuiElement({
            dom: createSvg(collapseSvg),
            class: 'category-collapse-icon'
        });

        // 创建分类标签
        this.categoryLabel = new Label({
            text: title,
            class: 'category-label'
        });

        // 组装头部
        this.headerElement.append(this.collapseIcon);
        this.headerElement.append(this.categoryLabel);

        // 创建内容容器
        this.contentContainer = new Container({
            class: 'category-content'
        });

        // 组装整体结构
        this.append(this.headerElement);
        this.append(this.contentContainer);

        // 绑定点击事件
        this.headerElement.dom.addEventListener('click', (event: MouseEvent) => {
            event.stopPropagation();
            this.toggleCollapse();
        });
    }

    toggleCollapse() {
        this._collapsed = !this._collapsed;
        if (this._collapsed) {
            this.contentContainer.hidden = true;
            this.collapseIcon.dom.style.transform = 'rotate(-90deg)';
            this.class.add('collapsed');
        } else {
            this.contentContainer.hidden = false;
            this.collapseIcon.dom.style.transform = 'rotate(0deg)';
            this.class.remove('collapsed');
        }
    }

    appendToContent(element: PcuiElement) {
        this.contentContainer.append(element);
    }

    removeFromContent(element: PcuiElement) {
        this.contentContainer.remove(element);
    }

    set collapsed(value: boolean) {
        if (this._collapsed !== value) {
            this.toggleCollapse();
        }
    }

    get collapsed() {
        return this._collapsed;
    }
}

class SplatItem extends Container {
    getName: () => string;
    setName: (value: string) => void;
    getSelected: () => boolean;
    setSelected: (value: boolean) => void;
    getVisible: () => boolean;
    setVisible: (value: boolean) => void;
    destroy: () => void;

    constructor(name: string, edit: TextInput, args = {}) {
        args = {
            ...args,
            class: ['splat-item', 'visible']
        };

        super(args);

        const text = new Label({
            class: 'splat-item-text',
            text: name
        });

        const visible = new PcuiElement({
            dom: createSvg(shownSvg),
            class: 'splat-item-visible'
        });

        const invisible = new PcuiElement({
            dom: createSvg(hiddenSvg),
            class: 'splat-item-visible',
            hidden: true
        });

        const duplicate = new PcuiElement({
            dom: createSvg(selectDuplicateSvg),
            class: 'splat-item-duplicate'
        });
        duplicate.dom.title = '原位复制';

        const remove = new PcuiElement({
            dom: createSvg(deleteSvg),
            class: 'splat-item-delete'
        });

        this.append(text);
        this.append(visible);
        this.append(invisible);
        this.append(duplicate);
        this.append(remove);

        this.getName = () => {
            return text.value;
        };

        this.setName = (value: string) => {
            text.value = value;
        };

        this.getSelected = () => {
            return this.class.contains('selected');
        };

        this.setSelected = (value: boolean) => {
            if (value !== this.selected) {
                if (value) {
                    this.class.add('selected');
                    this.emit('select', this);
                } else {
                    this.class.remove('selected');
                    this.emit('unselect', this);
                }
            }
        };

        this.getVisible = () => {
            return this.class.contains('visible');
        };

        this.setVisible = (value: boolean) => {
            if (value !== this.visible) {
                visible.hidden = !value;
                invisible.hidden = value;
                if (value) {
                    this.class.add('visible');
                    this.emit('visible', this);
                } else {
                    this.class.remove('visible');
                    this.emit('invisible', this);
                }
            }
        };

        const toggleVisible = (event: MouseEvent) => {
            event.stopPropagation();
            event.preventDefault();
            this.visible = !this.visible;
        };

        const handleDuplicate = (event: MouseEvent) => {
            event.stopPropagation();
            event.preventDefault();
            this.emit('duplicateClicked', this);
        };

        const handleRemove = (event: MouseEvent) => {
            event.stopPropagation();
            event.preventDefault();
            this.emit('removeClicked', this);
        };

        // rename on double click
        text.dom.addEventListener('dblclick', (event: MouseEvent) => {
            event.stopPropagation();

            const onblur = () => {
                this.remove(edit);
                this.emit('rename', edit.value);
                edit.input.removeEventListener('blur', onblur);
                text.hidden = false;
            };

            text.hidden = true;

            this.appendAfter(edit, text);
            edit.value = text.value;
            edit.input.addEventListener('blur', onblur);
            edit.focus();
        });

        // handle clicks
        visible.dom.addEventListener('click', toggleVisible);
        invisible.dom.addEventListener('click', toggleVisible);
        duplicate.dom.addEventListener('click', handleDuplicate);
        remove.dom.addEventListener('click', handleRemove);

        // 保存事件处理器引用以便后续移除
        const handleItemClick = (event: MouseEvent) => {
            // 如果点击的是按钮，就不处理选择
            const target = event.target as HTMLElement;
            if (target.closest('.splat-item-visible') ||
                target.closest('.splat-item-duplicate') ||
                target.closest('.splat-item-delete')) {
                return;
            }
            // 否则触发选择事件
            this.emit('click', this);
        };

        // 绑定点击事件
        this.dom.addEventListener('click', handleItemClick);

        this.destroy = () => {
            visible.dom.removeEventListener('click', toggleVisible);
            invisible.dom.removeEventListener('click', toggleVisible);
            duplicate.dom.removeEventListener('click', handleDuplicate);
            remove.dom.removeEventListener('click', handleRemove);
            this.dom.removeEventListener('click', handleItemClick);
        };
    }

    set name(value: string) {
        this.setName(value);
    }

    get name() {
        return this.getName();
    }

    set selected(value) {
        this.setSelected(value);
    }

    get selected() {
        return this.getSelected();
    }

    set visible(value) {
        this.setVisible(value);
    }

    get visible() {
        return this.getVisible();
    }
}

class SplatList extends Container {
    private splatCategory: CategoryContainer;
    private gltfCategory: CategoryContainer;

    constructor(events: Events, args = {}) {
        args = {
            ...args,
            class: 'splat-list'
        };

        super(args);

        const items = new Map<Element, SplatItem>();

        // 创建分类容器
        this.splatCategory = new CategoryContainer('Splat Models (PLY/SPLAT/SOG)');
        this.gltfCategory = new CategoryContainer('GLTF Models');

        // 添加分类容器到主容器
        this.append(this.splatCategory);
        this.append(this.gltfCategory);

        // edit input used during renames
        const edit = new TextInput({
            id: 'splat-edit'
        });

        events.on('scene.elementAdded', (element: Element) => {
            if (element.type === ElementType.splat) {
                const splat = element as Splat;
                const item = new SplatItem(splat.name, edit);
                this.splatCategory.appendToContent(item);
                items.set(splat, item);

                // 绑定选择事件
                item.on('click', () => {
                    events.fire('selection', splat);
                });

                item.on('visible', () => {
                    splat.visible = true;

                    // also select it if there is no other selection
                    if (!events.invoke('selection')) {
                        events.fire('selection', splat);
                    }
                });
                item.on('invisible', () => {
                    splat.visible = false;
                });
                item.on('duplicateClicked', () => {
                    // Splat模型暂不支持复制功能，可在后续版本中实现
                    console.log('Splat模型复制功能暂未实现');
                });
                item.on('rename', (value: string) => {
                    events.fire('edit.add', new SplatRenameOp(splat, value));
                });
            } else if (element.type === ElementType.model) {
                const model = element as GltfModel;
                const item = new SplatItem(model.filename, edit);
                this.gltfCategory.appendToContent(item);
                items.set(model, item);

                // 绑定选择事件
                item.on('click', () => {
                    events.fire('selection', model);
                });

                item.on('visible', () => {
                    if (model.entity) {
                        model.visible = true;
                    }

                    // also select it if there is no other selection
                    if (!events.invoke('selection')) {
                        events.fire('selection', model);
                    }
                });
                item.on('invisible', () => {
                    if (model.entity) {
                        model.visible = false;
                    }
                });
                item.on('duplicateClicked', () => {
                    // 触发GLB模型复制事件，与右键菜单功能相同
                    events.fire('model.duplicate', model);
                    console.log('GLB模型原位复制:', model.filename);
                });
                item.on('removeClicked', () => {
                    model.destroy();
                });
                // 添加GLB模型重命名事件处理
                item.on('rename', (value: string) => {
                    events.fire('edit.add', new GltfModelRenameOp(model, value));
                });
            }
        });

        events.on('scene.elementRemoved', (element: Element) => {
            if (element.type === ElementType.splat || element.type === ElementType.model) {
                const item = items.get(element);
                if (item) {
                    if (element.type === ElementType.splat) {
                        this.splatCategory.removeFromContent(item);
                    } else if (element.type === ElementType.model) {
                        this.gltfCategory.removeFromContent(item);
                    }
                    items.delete(element);
                }
            }
        });

        events.on('selection.changed', (selection: Splat | GltfModel) => {
            items.forEach((value, key) => {
                value.selected = key === selection;
            });
        });

        events.on('splat.name', (splat: Splat) => {
            const item = items.get(splat);
            if (item) {
                item.name = splat.name;
            }
        });

        // 添加GLB模型名称更新事件处理
        events.on('model.name', (model: GltfModel) => {
            const item = items.get(model);
            if (item) {
                item.name = model.filename;
            }
        });

        events.on('splat.visibility', (splat: Splat) => {
            const item = items.get(splat);
            if (item) {
                item.visible = splat.visible;
            }
        });

        events.on('model.visibility', (model: GltfModel) => {
            const item = items.get(model);
            if (item) {
                item.visible = model.visible;
            }
        });

        // 选择事件现在直接在SplatItem创建时绑定，不再需要在SplatList级别处理

        this.on('removeClicked', async (item: SplatItem) => {
            let element;
            for (const [key, value] of items) {
                if (item === value) {
                    element = key;
                    break;
                }
            }

            if (!element) {
                return;
            }

            const elementName = element.type === ElementType.splat ?
                (element as Splat).name :
                (element as GltfModel).filename;

            const result = await events.invoke('showPopup', {
                type: 'yesno',
                header: `Remove ${element.type === ElementType.splat ? 'Splat' : 'Model'}`,
                message: `Are you sure you want to remove '${elementName}' from the scene? This operation can not be undone.`
            });

            if (result?.action === 'yes') {
                element.destroy();
            }
        });
    }

    // 不再需要_onAppendChild和_onRemoveChild方法，因为事件绑定现在在SplatItem创建时直接处理
}

export { SplatList, SplatItem, CategoryContainer };
