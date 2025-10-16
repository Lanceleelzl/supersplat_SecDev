import { Container, Element } from '@playcanvas/pcui';
import { Events } from '../events';
import { Scene } from '../scene';

/**
 * 快照预览窗口 - 仅保留UI占位
 */
class SnapshotView extends Container {
    private events: Events;
    private scene: Scene;

    constructor(events: Events, scene: Scene, args = {}) {
        super({
            id: 'snapshot-panel',
            class: 'snapshot-view',
            ...args
        });

        this.events = events;
        this.scene = scene;
        
        // stop pointer events bubbling - 阻止指针事件冒泡
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });
        
        this.createUI();
        
        // 添加clickable类
        this.dom.classList.add('clickable');
        
        // 初始隐藏
        this.hidden = true;
        
        // 添加到body
        document.body.appendChild(this.dom);
    }

    private createUI() {
        // 创建基本的UI结构作为占位
        this.dom.innerHTML = `
            <div class="snapshot-titlebar">
                <span class="snapshot-title">快照预览</span>
            </div>
            <div class="snapshot-content">
                <div class="placeholder-message">
                    功能暂未实现
                </div>
            </div>
        `;
    }

    show() {
        this.hidden = false;
    }

    hide() {
        this.hidden = true;
    }
}

export { SnapshotView };
