import { EventHandler } from 'playcanvas';

type FunctionCallback = (...args: any[]) => any;

// 事件管理类，继承自PlayCanvas的EventHandler，提供函数注册和调用功能
class Events extends EventHandler {
    functions = new Map<string, FunctionCallback>();  // 函数映射表

    // 注册编辑器函数
    function(name: string, fn: FunctionCallback) {
        if (this.functions.has(name)) {
            throw new Error(`错误：函数 ${name} 已存在`);
        }
        this.functions.set(name, fn);
    }

    // 调用编辑器函数
    invoke(name: string, ...args: any[]) {
        const fn = this.functions.get(name);
        if (!fn) {
            console.log(`错误：未找到函数 '${name}'`);
            return;
        }
        return fn(...args);
    }
}

export { Events };
