import { TranslateGizmo } from 'playcanvas';

import { TransformTool } from './transform-tool';
import { Events } from '../events';
import { Scene } from '../scene';

// 移动工具类，用于拖拽移动场景中的对象
class MoveTool extends TransformTool {
    constructor(events: Events, scene: Scene) {
        // 创建平移小工具
        const gizmo = new TranslateGizmo(scene.camera.entity.camera, scene.gizmoLayer);

        super(gizmo, events, scene);
    }
}

export { MoveTool };
