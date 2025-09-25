import { Asset, BoundingBox, Entity, Vec3, Quat } from 'playcanvas';

import { Element, ElementType } from './element';

/**
 * glTF Model element for the scene hierarchy
 */
class GltfModel extends Element {
    entity: Entity;
    asset: Asset;
    private _cachedWorldBound: BoundingBox | null = null;
    private _cachedWorldBoundFrame = -1;
    static debugAabb = false; // 默认关闭详细 AABB 日志，如需调试设为 true

    constructor(asset: Asset, entity: Entity) {
        super(ElementType.model);
        this.asset = asset;
        this.entity = entity;
        // NOTE: 不再在每个 mesh 上注册 pointer 事件，统一由摄像机射线拾取 (camera.pickFocalPoint) 处理
        // 添加物理拾取辅助（可选）
        try {
            this.setupPhysicsPicking();
        } catch { /* ignore physics setup failure */ }
    }

    get filename() {
        return this.asset.name;
    }

    // 旧的基于 entity 递归 pointer 事件的点击方案已移除，防止与摄像机拾取重复触发

    // 为模型添加一个碰撞体用于基于刚体射线拾取
    private setupPhysicsPicking() {
        if (!this.entity || !this.scene) return;
        const app: any = this.scene.app;
        if (!app?.systems?.rigidbody || !app?.systems?.collision) return; // 未启用物理

        // 标记可拾取
        this.entity.tags.add('pickable');

        // 若已有 collider 则跳过
        if (this.entity.findOne((n: Entity) => n.name === '__gltfCollider')) return;

        const bound = this.worldBound;
        if (!bound) return;

        const collider = new Entity('__gltfCollider');
        const he = bound.halfExtents.clone();
        // 由于模型可能被移动，直接使用当前 worldBound 尺寸；位置采用包围盒中心
        collider.setPosition(bound.center);
        collider.addComponent('collision', {
            type: 'box',
            halfExtents: he
        });
        collider.addComponent('rigidbody', { type: 'kinematic', mass: 0 });

        // 把引用挂到 collider 方便反查对应 GltfModel
        (collider as any)._gltfModel = this;
        this.entity.addChild(collider);
    }

    add() {
        // Entity is already added to the scene root in asset-loader
        // This method is called when the element is added to the scene
    }

    remove() {
        // Remove the entity from its parent
        if (this.entity && this.entity.parent) {
            this.entity.parent.removeChild(this.entity);
        }
    }

    destroy() {
        // Previously would remove pointer listeners; now no-op
        this.entity?.destroy();
        super.destroy();
    }
    // removeClickFromEntityRecursive removed – pointer handlers no longer installed

    get worldBound(): BoundingBox | null {
        if (!this.entity) return null;

        const frame = (this.scene && (this.scene.app as any).frame) || (window as any).pc?.frameworkFrame || performance.now();
        if (this._cachedWorldBound && this._cachedWorldBoundFrame === frame) {
            return this._cachedWorldBound;
        }

        const renderComponents = this.entity.findComponents('render');
        if (GltfModel.debugAabb) {
            console.log('🔍 DEBUG: GltfModel worldBound calculation', {
                filename: this.filename,
                renderComponentsCount: renderComponents.length
            });
        }
        const meshInstances = renderComponents
        .map((render: any) => render.meshInstances)
        .flat()
        .filter((mi: any) => mi && mi.aabb);
        if (GltfModel.debugAabb) {
            console.log('🔍 DEBUG: Mesh instances found', {
                filename: this.filename,
                meshInstancesCount: meshInstances.length
            });
        }
        if (!meshInstances.length) {
            if (GltfModel.debugAabb) {
                console.log('🚨 DEBUG: No mesh instances with aabb', { filename: this.filename });
            }
            return null;
        }

        const bound = new BoundingBox();
        let first = true;
        for (const mi of meshInstances) {
            if (!mi.aabb || !mi.node) continue;
            const localAabb = mi.aabb;
            const worldTransform = mi.node.getWorldTransform();
            const worldAabb = new BoundingBox();
            worldAabb.setFromTransformedAabb(localAabb, worldTransform);
            if (GltfModel.debugAabb) {
                console.log('🔍 DEBUG: Mesh instance AABB', {
                    filename: this.filename,
                    localCenter: localAabb.center.toString(),
                    localHalfExtents: localAabb.halfExtents.toString(),
                    worldCenter: worldAabb.center.toString(),
                    worldHalfExtents: worldAabb.halfExtents.toString()
                });
            }
            if (first) {
                bound.copy(worldAabb);
                first = false;
            } else {
                bound.add(worldAabb);
            }
        }
        if (GltfModel.debugAabb) {
            console.log('🔍 DEBUG: Final world bound', {
                filename: this.filename,
                center: bound.center.toString(),
                halfExtents: bound.halfExtents.toString(),
                min: bound.getMin().toString(),
                max: bound.getMax().toString()
            });
        }
        this._cachedWorldBound = bound;
        this._cachedWorldBoundFrame = frame;
        return bound;
    }

    serialize(serializer: any) {
        super.serialize(serializer);
        
        // Store basic model information for potential future use
        const position = this.entity.getPosition();
        const rotation = this.entity.getRotation();
        const scale = this.entity.getLocalScale();
        
        // Could be used for saving/loading scene state
        const modelData = {
            filename: this.filename,
            position: [position.x, position.y, position.z],
            rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
            scale: [scale.x, scale.y, scale.z]
        };
        
        // Store in serializer if needed
        if (serializer && serializer.setModelData) {
            serializer.setModelData(this.uid, modelData);
        }
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (this.entity) {
            if (position) {
                this.entity.setPosition(position);
            }
            if (rotation) {
                this.entity.setRotation(rotation);
            }
            if (scale) {
                this.entity.setLocalScale(scale);
            }
            
            // Mark world bounds as dirty since the model moved
            this.makeWorldBoundDirty();

            // 同步更新物理拾取 collider（如果存在）
            try {
                const colliderNode = this.entity.findOne((n: Entity) => n.name === '__gltfCollider');
                const collider = colliderNode as unknown as Entity;
                if (collider && (collider as any).collision) {
                    const wb = this.worldBound; // 重新计算
                    if (wb) {
                        collider.setPosition(wb.center);
                        const col: any = (collider as any).collision;
                        if (col?.type === 'box') {
                            const he = wb.halfExtents;
                            if (col.halfExtents?.set) {
                                col.halfExtents.set(he.x, he.y, he.z);
                            } else {
                                // recreate collision component (rare)
                                try {
                                    (collider as any).removeComponent('collision');
                                } catch {
                                    // ignore
                                }
                                (collider as any).addComponent('collision', { type: 'box', halfExtents: he.clone() });
                            }
                        }
                    }
                }
            } catch { /* ignore collider sync errors */ }
            
            // Force scene to re-render immediately
            if (this.scene) {
                this.scene.forceRender = true;
            }
            
            // Fire transform event for selection system and other listeners
            this.scene?.events.fire('model.moved', this);
        }
    }
    
    makeWorldBoundDirty() {
        // 标记缓存失效，并强制 mesh aabb 更新
        this._cachedWorldBound = null;
        this._cachedWorldBoundFrame = -1;
        if (!this.entity) return;
        const renderComponents = this.entity.findComponents('render');
        renderComponents.forEach((render: any) => {
            if (!render.meshInstances) return;
            render.meshInstances.forEach((meshInstance: any) => {
                if (meshInstance.aabb) {
                    meshInstance._aabbVer = -1;
                }
            });
        });
    }

    set visible(value: boolean) {
        if (this.entity) {
            if (value) {
                // Make visible: add to scene if not already there
                if (!this.entity.parent && this.scene) {
                    this.scene.app.root.addChild(this.entity);
                }
                this.entity.enabled = true;
                
                // Enable all render components recursively
                const enableRendering = (entity: Entity) => {
                    const render = entity.render;
                    if (render) {
                        render.enabled = true;
                        if (render.meshInstances) {
                            render.meshInstances.forEach((meshInstance) => {
                                meshInstance.visible = true;
                            });
                        }
                    }
                    
                    entity.children.forEach((child) => {
                        if (child instanceof Entity) {
                            child.enabled = true;
                            enableRendering(child);
                        }
                    });
                };
                enableRendering(this.entity);
            } else {
                // Make invisible: disable entity and rendering
                this.entity.enabled = false;
                
                // Disable all render components recursively
                const disableRendering = (entity: Entity) => {
                    const render = entity.render;
                    if (render) {
                        render.enabled = false;
                        if (render.meshInstances) {
                            render.meshInstances.forEach((meshInstance) => {
                                meshInstance.visible = false;
                            });
                        }
                    }
                    
                    entity.children.forEach((child) => {
                        if (child instanceof Entity) {
                            child.enabled = false;
                            disableRendering(child);
                        }
                    });
                };
                disableRendering(this.entity);
            }
            
            // Force scene to re-render immediately
            if (this.scene) {
                this.scene.forceRender = true;
            }
            
            // Fire visibility event for selection system
            this.scene?.events.fire('model.visibility', this);
        }
    }

    get visible(): boolean {
        return this.entity?.enabled !== false;
    }

    // Placeholder method for compatibility with document serialization
    docDeserialize(_splatSettings: any) {
        // glTF models don't need document deserialization like Splats do
        // This is a placeholder for compatibility
    }
}

export { GltfModel };
