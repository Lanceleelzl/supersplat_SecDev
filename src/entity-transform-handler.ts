import { Mat4, Quat, Vec3 } from 'playcanvas';

import { PlacePivotOp, EntityTransformOp, MultiOp } from './edit-ops';
import { ElementType } from './element';
import { Events } from './events';
import { GltfModel } from './gltf-model';
import { Pivot } from './pivot';
import { Splat } from './splat';
import { Transform } from './transform';
import { TransformHandler } from './transform-handler';

const mat = new Mat4();
const quat = new Quat();
const transform = new Transform();

class EntityTransformHandler implements TransformHandler {
    events: Events;
    target: Splat | GltfModel;
    top: EntityTransformOp;
    pop: PlacePivotOp;
    bindMat = new Mat4();

    constructor(events: Events) {
        this.events = events;

        events.on('pivot.started', (_pivot: Pivot) => {
            if (this.target) {
                this.start();
            }
        });

        events.on('pivot.moved', (pivot: Pivot) => {
            if (this.target) {
                this.update(pivot.transform);
            }
        });

        events.on('pivot.ended', (_pivot: Pivot) => {
            if (this.target) {
                this.end();
            }
        });

        events.on('pivot.origin', (_mode: 'center' | 'boundCenter') => {
            if (this.target) {
                this.placePivot();
            }
        });

        events.on('camera.focalPointPicked', (details: { splat?: Splat, model?: GltfModel, position: Vec3 }) => {
            if (this.target && ['move', 'rotate', 'scale'].includes(this.events.invoke('tool.active'))) {
                const pivot = events.invoke('pivot') as Pivot;
                const oldt = pivot.transform.clone();
                const newt = new Transform(details.position, pivot.transform.rotation, pivot.transform.scale);
                const op = new PlacePivotOp({ pivot, oldt, newt });
                events.fire('edit.add', op);
            }
        });
    }

    placePivot() {
        // place initial pivot point
        const origin = this.events.invoke('pivot.origin');

        if (this.target.type === ElementType.splat) {
            (this.target as Splat).getPivot(origin === 'center' ? 'center' : 'boundCenter', false, transform);
        } else if (this.target.type === ElementType.model) {
            // For GLB models, use entity position and world bound center
            const model = this.target as GltfModel;
            const bound = model.worldBound;
            if (bound && origin === 'boundCenter') {
                transform.position.copy(bound.center);
            } else {
                transform.position.copy(model.entity.getPosition());
            }
            transform.rotation.copy(model.entity.getRotation());
            transform.scale.copy(model.entity.getLocalScale());
        }

        this.events.fire('pivot.place', transform);
    }

    activate() {
        this.target = this.events.invoke('selection') as Splat | GltfModel;
        if (this.target) {
            this.placePivot();
        }
    }

    deactivate() {
        this.target = null;
    }

    start() {
        const pivot = this.events.invoke('pivot') as Pivot;
        const { transform } = pivot;

        let entity;
        if (this.target.type === ElementType.splat) {
            entity = (this.target as Splat).entity;
        } else if (this.target.type === ElementType.model) {
            entity = (this.target as GltfModel).entity;
        }

        // calculate bind matrix
        this.bindMat.setTRS(transform.position, transform.rotation, transform.scale);
        this.bindMat.invert();
        this.bindMat.mul2(this.bindMat, entity.getLocalTransform());

        const p = entity.getLocalPosition();
        const r = entity.getLocalRotation();
        const s = entity.getLocalScale();

        // create op
        this.top = new EntityTransformOp({
            target: this.target,
            oldt: new Transform(p, r, s),
            newt: new Transform(p, r, s)
        });

        this.pop = new PlacePivotOp({
            pivot,
            oldt: transform.clone(),
            newt: transform.clone()
        });
    }

    update(transform: Transform) {
        mat.setTRS(transform.position, transform.rotation, transform.scale);
        mat.mul2(mat, this.bindMat);
        quat.setFromMat4(mat);

        const t = mat.getTranslation();
        const r = quat;
        const s = mat.getScale();

        this.target.move(t, r, s);
        this.top.newt.set(t, r, s);
        this.pop.newt.copy(transform);
        
        // 触发实时变换事件，用于快照预览等实时更新
        this.events.fire('transform.changed', this.target);
    }

    end() {
        // if anything changed then register the op with undo/redo system
        const { oldt, newt } = this.top;

        if (!oldt.equals(newt)) {
            this.events.fire('edit.add', new MultiOp([this.top, this.pop]));
            // 触发变换完成事件
            this.events.fire('transform.changed', this.target);
        }

        this.top = null;
        this.pop = null;
    }
}

export { EntityTransformHandler };
