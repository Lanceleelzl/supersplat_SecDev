import { Events } from './events';

// 快捷键选项接口
interface ShortcutOptions {
    ctrl?: boolean;         // 是否需要Ctrl键
    shift?: boolean;        // 是否需要Shift键
    sticky?: boolean;       // 是否是粘性快捷键（切换模式）
    capture?: boolean;      // 使用捕获阶段 - 即在其他人之前处理事件
    func?: () => void;      // 回调函数
    event?: string;         // 事件名称
}

// 快捷键管理类
class Shortcuts {
    shortcuts: { keys: string[], options: ShortcutOptions, toggled: boolean }[] = [];  // 快捷键列表

    constructor(events: Events) {
        const shortcuts = this.shortcuts;

        const handleEvent = (e: KeyboardEvent, down: boolean, capture: boolean) => {
            // 跳过输入字段中的按键
            if (!capture && e.target !== document.body) return;

            for (let i = 0; i < shortcuts.length; i++) {
                const shortcut  = shortcuts[i];
                const options = shortcut.options;

                if (shortcut.keys.includes(e.key) &&
                    ((options.capture ?? false) === capture) &&
                    !!options.ctrl === !!(e.ctrlKey || e.metaKey) &&
                    !!options.shift === !!e.shiftKey) {

                    e.stopPropagation();
                    e.preventDefault();

                    // 处理粘性快捷键
                    if (options.sticky) {
                        if (down) {
                            shortcut.toggled = e.repeat;
                        }

                        if (down === shortcut.toggled) {
                            return;
                        }
                    } else {
                        // 忽略非粘性快捷键的按键释放事件
                        if (!down) return;
                    }

                    if (shortcuts[i].options.event) {
                        events.fire(shortcuts[i].options.event);
                    } else {
                        shortcuts[i].options.func();
                    }

                    break;
                }
            }
        };

        // register keyboard handler
        document.addEventListener('keydown', (e) => {
            handleEvent(e, true, false);
        });

        document.addEventListener('keyup', (e) => {
            handleEvent(e, false, false);
        });

        // also handle capture phase
        document.addEventListener('keydown', (e) => {
            handleEvent(e, true, true);
        }, true);

        document.addEventListener('keyup', (e) => {
            handleEvent(e, false, true);
        }, true);
    }

    register(keys: string[], options: ShortcutOptions) {
        this.shortcuts.push({ keys, options, toggled: false });
    }
}

export {
    Shortcuts
};
