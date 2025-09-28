import { Asset, BoundingBox, Entity, Vec3, Quat, Mat4, Color } from 'playcanvas';

import { Element, ElementType } from './element';

/**
 * glTF Model element for the scene hierarchy
 */
class GltfModel extends Element {
    entity: Entity;
    asset: Asset;
    private _cachedWorldBound: BoundingBox | null = null;
    private _cachedWorldBoundFrame = -1;

    constructor(asset: Asset, entity: Entity) {
        super(ElementType.model);
        this.asset = asset;
        this.entity = entity;

        // Ensure the model is visible by default
        this.visible = true;

        // Setup physics picking if available
        try {
            this.setupPhysicsPicking();
        } catch { /* ignore physics setup failure */ }
    }

    get filename() {
        return this.asset.name;
    }

    // Setup physics collision detection for ray picking
    private setupPhysicsPicking() {
        if (!this.entity || !this.scene) return;
        const app: any = this.scene.app;
        if (!app?.systems?.rigidbody || !app?.systems?.collision) return;

        this.entity.tags.add('pickable');

        // Skip if collider already exists
        if (this.scene.app.root.findOne((n: Entity) => n.name === '__gltfCollider' && (n as any)._gltfModel === this)) return;

        const bound = this.worldBound;
        if (!bound) return;

        const collider = new Entity('__gltfCollider');
        const he = bound.halfExtents.clone();

        const worldCenter = bound.center.clone();
        collider.setPosition(worldCenter);

        collider.addComponent('collision', {
            type: 'box',
            halfExtents: he
        });
        collider.addComponent('rigidbody', { type: 'kinematic', mass: 0 });

        (collider as any)._gltfModel = this;
        this.scene.app.root.addChild(collider);
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
        this.entity?.destroy();
        super.destroy();
    }

    getLocalBound(): BoundingBox | null {
        if (!this.entity) return null;

        const renderComponents = this.entity.findComponents('render');
        const meshInstances = renderComponents
        .map((render: any) => render.meshInstances)
        .flat()
        .filter((mi: any) => mi && mi.aabb);

        if (!meshInstances.length) {
            return null;
        }

        // Calculate local bound by combining all mesh instance local AABBs
        const bound = new BoundingBox();
        let first = true;
        for (const mi of meshInstances) {
            if (!mi.aabb) continue;

            if (first) {
                bound.copy(mi.aabb);
                first = false;
            } else {
                bound.add(mi.aabb);
            }
        }

        return bound;
    }

    get worldBound(): BoundingBox | null {
        if (!this.entity) return null;

        const frame = (this.scene && (this.scene.app as any).frame) || (window as any).pc?.frameworkFrame || performance.now();
        if (this._cachedWorldBound && this._cachedWorldBoundFrame === frame) {
            return this._cachedWorldBound;
        }

        const renderComponents = this.entity.findComponents('render');
        const meshInstances = renderComponents
        .map((render: any) => render.meshInstances)
        .flat()
        .filter((mi: any) => mi && mi.aabb);

        if (!meshInstances.length) {
            return null;
        }

        // For GLB models, use mesh instance local AABB directly
        // as the mesh nodes already contain correct world coordinates
        const bound = new BoundingBox();
        let first = true;
        for (const mi of meshInstances) {
            if (!mi.aabb) continue;

            if (first) {
                bound.copy(mi.aabb);
                first = false;
            } else {
                bound.add(mi.aabb);
            }
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

            // Update physics collider if it exists
            try {
                const collider = this.scene.app.root.findOne((n: Entity) => n.name === '__gltfCollider' && (n as any)._gltfModel === this);
                if (collider && (collider as any).collision) {
                    const wb = this.worldBound;
                    if (wb) {
                        collider.setPosition(wb.center);
                        const col: any = (collider as any).collision;
                        if (col?.type === 'box') {
                            const he = wb.halfExtents;
                            if (col.halfExtents?.set) {
                                col.halfExtents.set(he.x, he.y, he.z);
                            } else {
                                // Recreate collision component if needed
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

    onPreRender() {
        const events = this.scene?.events;
        if (!events || !this.entity) return;

        const selected = events.invoke('selection') === this;

        if (this.visible && selected) {
            // render bounding box when selected
            // 注释：暂时注释掉GLB模型选中时的包围盒显示功能
            // if (events.invoke('camera.bound')) {
            //     const bound = this.worldBound;
            //     if (bound) {
            //         // Use the same boundingPoints structure as Splat for consistency
            //         const boundingPoints = [
            //             // Bottom face edges
            //             new Vec3(-1, -1, -1), new Vec3(1, -1, -1),   // bottom front edge
            //             new Vec3(1, -1, -1), new Vec3(1, 1, -1),     // bottom right edge
            //             new Vec3(1, 1, -1), new Vec3(-1, 1, -1),     // bottom back edge
            //             new Vec3(-1, 1, -1), new Vec3(-1, -1, -1),   // bottom left edge

            //             // Top face edges
            //             new Vec3(-1, -1, 1), new Vec3(1, -1, 1),     // top front edge
            //             new Vec3(1, -1, 1), new Vec3(1, 1, 1),       // top right edge
            //             new Vec3(1, 1, 1), new Vec3(-1, 1, 1),       // top back edge
            //             new Vec3(-1, 1, 1), new Vec3(-1, -1, 1),     // top left edge

            //             // Vertical edges
            //             new Vec3(-1, -1, -1), new Vec3(-1, -1, 1),   // front left vertical
            //             new Vec3(1, -1, -1), new Vec3(1, -1, 1),     // front right vertical
            //             new Vec3(1, 1, -1), new Vec3(1, 1, 1),       // back right vertical
            //             new Vec3(-1, 1, -1), new Vec3(-1, 1, 1)      // back left vertical
            //         ];

            //         // Use worldBound to draw bounding box
            //         const scale = new Mat4().setTRS(bound.center, Quat.IDENTITY, bound.halfExtents);

            //         // Draw bounding box lines
            //         const veca = new Vec3();
            //         const vecb = new Vec3();

            //         for (let i = 0; i < boundingPoints.length; i += 2) {
            //             const a = boundingPoints[i];
            //             const b = boundingPoints[i + 1];

            //             // Transform unit cube points to actual bounding box coordinates
            //             scale.transformPoint(a, veca);
            //             scale.transformPoint(b, vecb);

            //             this.scene.app.drawLine(veca, vecb, Color.WHITE, true, this.scene.debugLayer);
            //         }
            //     }
            // }
        }
    }

    // Placeholder method for compatibility with document serialization
    docDeserialize(_splatSettings: any) {
        // glTF models don't need document deserialization like Splats do
        // This is a placeholder for compatibility
    }
}

export { GltfModel };
