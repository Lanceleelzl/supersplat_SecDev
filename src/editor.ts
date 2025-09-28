import { Color, Mat4, Texture, Vec3, Vec4 } from 'playcanvas';

import { EditHistory } from './edit-history';
import { SelectAllOp, SelectNoneOp, SelectInvertOp, SelectOp, HideSelectionOp, UnhideAllOp, DeleteSelectionOp, ResetOp, MultiOp, AddSplatOp } from './edit-ops';
import { Events } from './events';
import { GltfModel } from './gltf-model';
import { Scene } from './scene';
import { BufferWriter } from './serialize/writer';
import { Splat } from './splat';
import { serializePly } from './splat-serialize';

// 注册编辑器和场景事件
const registerEditorEvents = (events: Events, editHistory: EditHistory, scene: Scene) => {
    const vec = new Vec3();
    const vec2 = new Vec3();
    const vec4 = new Vec4();
    const mat = new Mat4();

    // 获取已选择的点云列表（目前限制为只能选择一个）
    const selectedSplats = () => {
        const selected = events.invoke('selection') as Splat;
        return selected?.visible ? [selected] : [];
    };

    let lastExportCursor = 0;

    // 深度克隆实体的辅助函数
    const deepCloneEntity = (originalEntity: any, namePrefix: string): any => {
        // 使用PlayCanvas的clone方法
        const cloned = originalEntity.clone();

        // 设置唯一名称
        cloned.name = `${namePrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 确保从父节点分离
        if (cloned.parent && cloned.parent !== originalEntity.parent) {
            cloned.parent.removeChild(cloned);
        }

        // 递归处理子实体，确保它们也有唯一的名称和独立性
        if (cloned.children && cloned.children.length > 0) {
            cloned.children.forEach((child: any, index: number) => {
                child.name = `${child.name}_clone_${index}_${Date.now()}`;
                child.enabled = true;
            });
        }

        return cloned;
    };

    // 克隆GLB模型的辅助函数
    const cloneGltfModel = (originalModel: GltfModel, newFilename: string, scene: Scene): GltfModel | null => {
        try {
            // 使用深度克隆来确保完全独立的实体
            const clonedEntity = deepCloneEntity(originalModel.entity, newFilename);
            if (!clonedEntity) {
                console.error('无法克隆实体');
                return null;
            }

            // 手动复制变换信息到克隆的实体
            const originalPos = originalModel.entity.getLocalPosition();
            const originalRot = originalModel.entity.getLocalRotation();
            const originalScale = originalModel.entity.getLocalScale();

            clonedEntity.setLocalPosition(originalPos);
            clonedEntity.setLocalRotation(originalRot);
            clonedEntity.setLocalScale(originalScale);

            // 创建一个新的GltfModel实例，传入自定义文件名
            const clonedModel = new GltfModel(originalModel.asset, clonedEntity, newFilename);

            // 复制原始模型的属性
            clonedModel.visible = originalModel.visible;

            // 确保实体被正确启用
            clonedEntity.enabled = true;

            // 递归确保所有子实体也被正确启用
            function enableAllEntities(entity: any) {
                entity.enabled = true;
                if (entity.children) {
                    entity.children.forEach((child: any) => enableAllEntities(child));
                }
            }
            enableAllEntities(clonedEntity);

            console.log('复制的模型创建成功:', newFilename, '实体名称:', clonedEntity.name);

            return clonedModel;
        } catch (error) {
            console.error('克隆GLB模型时出错:', error);
            return null;
        }
    };

    // GLB模型复制辅助函数
    const duplicateGltfModel = (originalModel: GltfModel, scene: Scene): GltfModel | null => {
        try {
            // 获取原始模型的文件信息
            const originalFilename = originalModel.filename;

            // 检查是否有可用的文件数据
            if (!originalModel.asset) {
                console.warn('无法复制模型：缺少资产引用');
                return null;
            }

            // 创建新的文件名，使用中文"_复制"
            const copyFilename = originalFilename ? `${originalFilename}_复制` : '模型_复制';

            // 使用克隆方式创建独立的模型
            const duplicatedModel = cloneGltfModel(originalModel, copyFilename, scene);

            if (duplicatedModel) {
                // 复制变换信息，保持原位（不偏移）
                const originalPos = originalModel.entity.getPosition();
                const originalRot = originalModel.entity.getRotation();
                const originalScale = originalModel.entity.getLocalScale();

                // 设置新模型的位置，保持原位复制
                duplicatedModel.entity.setPosition(originalPos.x, originalPos.y, originalPos.z);
                duplicatedModel.entity.setRotation(originalRot);
                duplicatedModel.entity.setLocalScale(originalScale);

                // **关键修复：将实体添加到PlayCanvas的根节点**
                scene.app.root.addChild(duplicatedModel.entity);

                // 将新模型添加到场景（会自动触发scene.elementAdded事件）
                scene.add(duplicatedModel);

                // 强制刷新场景显示和渲染
                scene.forceRender = true;

                // 立即触发一次渲染更新
                setTimeout(() => {
                    scene.forceRender = true;
                }, 10);

                console.log('GLB模型复制完成:', copyFilename, '实体已添加到根节点');

                return duplicatedModel;
            }

            return null;
        } catch (error) {
            console.error('复制GLB模型时出错:', error);
            return null;
        }
    };

    // 添加未保存更改的警告消息
    window.addEventListener('beforeunload', (e) => {
        if (!events.invoke('scene.dirty')) {
            // 如果撤销光标匹配最后的导出状态，则没有未保存的更改
            return undefined;
        }

        const msg = '您有未保存的更改。确定要离开吗？';
        e.returnValue = msg;
        return msg;
    });

    events.function('targetSize', () => {
        return scene.targetSize;
    });

    events.on('scene.clear', () => {
        scene.clear();
        editHistory.clear();
        lastExportCursor = 0;
    });

    events.function('scene.dirty', () => {
        return editHistory.cursor !== lastExportCursor;
    });

    events.on('doc.saved', () => {
        lastExportCursor = editHistory.cursor;
    });

    events.on('camera.mode', () => {
        scene.forceRender = true;
    });

    events.on('camera.overlay', () => {
        scene.forceRender = true;
    });

    events.on('camera.splatSize', () => {
        scene.forceRender = true;
    });

    events.on('view.outlineSelection', () => {
        scene.forceRender = true;
    });

    events.on('view.bands', (bands: number) => {
        scene.forceRender = true;
    });

    events.on('camera.bound', () => {
        scene.forceRender = true;
    });

    // 网格可见性控制

    const setGridVisible = (visible: boolean) => {
        if (visible !== scene.grid.visible) {
            scene.grid.visible = visible;
            events.fire('grid.visible', visible);
        }
    };

    events.function('grid.visible', () => {
        return scene.grid.visible;
    });

    events.on('grid.setVisible', (visible: boolean) => {
        setGridVisible(visible);
    });

    events.on('grid.toggleVisible', () => {
        setGridVisible(!scene.grid.visible);
    });

    setGridVisible(scene.config.show.grid);

    // 相机视野角度控制

    const setCameraFov = (fov: number) => {
        if (fov !== scene.camera.fov) {
            scene.camera.fov = fov;
            events.fire('camera.fov', scene.camera.fov);
        }
    };

    events.function('camera.fov', () => {
        return scene.camera.fov;
    });

    events.on('camera.setFov', (fov: number) => {
        setCameraFov(fov);
    });

    // 相机色调映射控制

    events.function('camera.tonemapping', () => {
        return scene.camera.tonemapping;
    });

    events.on('camera.setTonemapping', (value: string) => {
        scene.camera.tonemapping = value;
    });

    // 相机边界框显示控制

    let bound = scene.config.show.bound;

    const setBoundVisible = (visible: boolean) => {
        if (visible !== bound) {
            bound = visible;
            events.fire('camera.bound', bound);
        }
    };

    events.function('camera.bound', () => {
        return bound;
    });

    events.on('camera.setBound', (value: boolean) => {
        setBoundVisible(value);
    });

    events.on('camera.toggleBound', () => {
        setBoundVisible(!events.invoke('camera.bound'));
    });

    // 相机聚焦功能

    events.on('camera.focus', () => {
        const splat = selectedSplats()[0];
        if (splat) {

            const bound = splat.numSelected > 0 ? splat.selectionBound : splat.localBound;
            vec.copy(bound.center);

            const worldTransform = splat.worldTransform;
            worldTransform.transformPoint(vec, vec);
            worldTransform.getScale(vec2);

            scene.camera.focus({
                focalPoint: vec,
                radius: bound.halfExtents.length() * vec2.x,
                speed: 1
            });
        }
    });

    events.on('camera.reset', () => {
        const { initialAzim, initialElev, initialZoom } = scene.config.controls;
        const x = Math.sin(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const y = -Math.sin(initialElev * Math.PI / 180);
        const z = Math.cos(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const zoom = initialZoom;

        scene.camera.setPose(new Vec3(x * zoom, y * zoom, z * zoom), new Vec3(0, 0, 0));
    });

    // 处理相机对齐事件
    events.on('camera.align', (axis: string) => {
        switch (axis) {
            case 'px': scene.camera.setAzimElev(90, 0); break;
            case 'py': scene.camera.setAzimElev(0, -90); break;
            case 'pz': scene.camera.setAzimElev(0, 0); break;
            case 'nx': scene.camera.setAzimElev(270, 0); break;
            case 'ny': scene.camera.setAzimElev(0, 90); break;
            case 'nz': scene.camera.setAzimElev(180, 0); break;
        }

        // 切换到正交模式
        scene.camera.ortho = true;
    });

    // 返回选中的点云是否包含已选中的高斯点
    events.function('selection.splats', () => {
        const splat = events.invoke('selection') as Splat;
        return splat?.numSelected > 0;
    });

    events.on('select.all', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectAllOp(splat));
        });
    });

    events.on('select.none', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectNoneOp(splat));
        });
    });

    events.on('select.invert', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectInvertOp(splat));
        });
    });

    events.on('select.pred', (op, pred: (i: number) => boolean) => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectOp(splat, op, pred));
        });
    });

    const intersectCenters = (splat: Splat, op: 'add'|'remove'|'set', options: any) => {
        const data = scene.dataProcessor.intersect(options, splat);
        const filter = (i: number) => data[i] === 255;
        events.fire('edit.add', new SelectOp(splat, op, filter));
    };

    events.on('select.bySphere', (op: 'add'|'remove'|'set', sphere: number[]) => {
        selectedSplats().forEach((splat) => {
            intersectCenters(splat, op, {
                sphere: { x: sphere[0], y: sphere[1], z: sphere[2], radius: sphere[3] }
            });
        });
    });

    events.on('select.byBox', (op: 'add'|'remove'|'set', box: number[]) => {
        selectedSplats().forEach((splat) => {
            intersectCenters(splat, op, {
                box: { x: box[0], y: box[1], z: box[2], lenx: box[3], leny: box[4], lenz: box[5] }
            });
        });
    });

    events.on('select.rect', (op: 'add'|'remove'|'set', rect: any) => {
        const mode = events.invoke('camera.mode');

        selectedSplats().forEach((splat) => {
            if (mode === 'centers') {
                intersectCenters(splat, op, {
                    rect: { x1: rect.start.x, y1: rect.start.y, x2: rect.end.x, y2: rect.end.y }
                });
            } else if (mode === 'rings') {
                const { width, height } = scene.targetSize;

                scene.camera.pickPrep(splat, op);
                const pick = scene.camera.pickRect(
                    Math.floor(rect.start.x * width),
                    Math.floor(rect.start.y * height),
                    Math.floor((rect.end.x - rect.start.x) * width),
                    Math.floor((rect.end.y - rect.start.y) * height)
                );

                const selected = new Set<number>(pick);
                const filter = (i: number) => {
                    return selected.has(i);
                };

                events.fire('edit.add', new SelectOp(splat, op, filter));
            }
        });
    });

    let maskTexture: Texture = null;

    events.on('select.byMask', (op: 'add'|'remove'|'set', canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
        const mode = events.invoke('camera.mode');

        selectedSplats().forEach((splat) => {
            if (mode === 'centers') {
                // create mask texture
                if (!maskTexture || maskTexture.width !== canvas.width || maskTexture.height !== canvas.height) {
                    if (maskTexture) {
                        maskTexture.destroy();
                    }
                    maskTexture = new Texture(scene.graphicsDevice);
                }
                maskTexture.setSource(canvas);

                intersectCenters(splat, op, {
                    mask: maskTexture
                });
            } else if (mode === 'rings') {
                const mask = context.getImageData(0, 0, canvas.width, canvas.height);

                // calculate mask bound so we limit pixel operations
                let mx0 = mask.width - 1;
                let my0 = mask.height - 1;
                let mx1 = 0;
                let my1 = 0;
                for (let y = 0; y < mask.height; ++y) {
                    for (let x = 0; x < mask.width; ++x) {
                        if (mask.data[(y * mask.width + x) * 4 + 3] === 255) {
                            mx0 = Math.min(mx0, x);
                            my0 = Math.min(my0, y);
                            mx1 = Math.max(mx1, x);
                            my1 = Math.max(my1, y);
                        }
                    }
                }

                const { width, height } = scene.targetSize;
                const px0 = Math.floor(mx0 / mask.width * width);
                const py0 = Math.floor(my0 / mask.height * height);
                const px1 = Math.floor(mx1 / mask.width * width);
                const py1 = Math.floor(my1 / mask.height * height);
                const pw = px1 - px0 + 1;
                const ph = py1 - py0 + 1;

                scene.camera.pickPrep(splat, op);
                const pick = scene.camera.pickRect(px0, py0, pw, ph);

                const selected = new Set<number>();
                for (let y = 0; y < ph; ++y) {
                    for (let x = 0; x < pw; ++x) {
                        const mx = Math.floor((px0 + x) / width * mask.width);
                        const my = Math.floor((py0 + y) / height * mask.height);
                        if (mask.data[(my * mask.width + mx) * 4] === 255) {
                            selected.add(pick[(ph - y) * pw + x]);
                        }
                    }
                }

                const filter = (i: number) => {
                    return selected.has(i);
                };

                events.fire('edit.add', new SelectOp(splat, op, filter));
            }
        });
    });

    events.on('select.point', (op: 'add'|'remove'|'set', point: { x: number, y: number }) => {
        const { width, height } = scene.targetSize;
        const mode = events.invoke('camera.mode');

        selectedSplats().forEach((splat) => {
            const splatData = splat.splatData;

            if (mode === 'centers') {
                const x = splatData.getProp('x');
                const y = splatData.getProp('y');
                const z = splatData.getProp('z');

                const splatSize = events.invoke('camera.splatSize');
                const camera = scene.camera.entity.camera;
                const sx = point.x * width;
                const sy = point.y * height;

                // calculate final matrix
                mat.mul2(camera.camera._viewProjMat, splat.worldTransform);

                const filter = (i: number) => {
                    vec4.set(x[i], y[i], z[i], 1.0);
                    mat.transformVec4(vec4, vec4);
                    const px = (vec4.x / vec4.w * 0.5 + 0.5) * width;
                    const py = (-vec4.y / vec4.w * 0.5 + 0.5) * height;
                    return Math.abs(px - sx) < splatSize && Math.abs(py - sy) < splatSize;
                };

                events.fire('edit.add', new SelectOp(splat, op, filter));
            } else if (mode === 'rings') {
                scene.camera.pickPrep(splat, op);

                const pickId = scene.camera.pickRect(
                    Math.floor(point.x * width),
                    Math.floor(point.y * height),
                    1, 1
                )[0];

                const filter = (i: number) => {
                    return i === pickId;
                };

                events.fire('edit.add', new SelectOp(splat, op, filter));
            }
        });
    });

    events.on('select.hide', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new HideSelectionOp(splat));
        });
    });

    events.on('select.unhide', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new UnhideAllOp(splat));
        });
    });

    events.on('select.delete', () => {
        selectedSplats().forEach((splat) => {
            editHistory.add(new DeleteSelectionOp(splat));
        });
    });

    const performSelectionFunc = async (func: 'duplicate' | 'separate') => {
        const splats = selectedSplats();

        const writer = new BufferWriter();

        await serializePly(splats, {
            maxSHBands: 3,
            selected: true
        }, writer);

        const buffers = writer.close();

        if (buffers) {
            const splat = splats[0];

            // wrap PLY in a blob and load it
            const blob = new Blob(buffers as unknown as ArrayBuffer[], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const { filename } = splat;
            const copy = await scene.assetLoader.loadPly({ url, filename });

            if (func === 'separate') {
                editHistory.add(new MultiOp([
                    new DeleteSelectionOp(splat),
                    new AddSplatOp(scene, copy)
                ]));
            } else {
                editHistory.add(new AddSplatOp(scene, copy));
            }

            URL.revokeObjectURL(url);
        }
    };

    // duplicate the current selection
    events.on('select.duplicate', async () => {
        await performSelectionFunc('duplicate');
    });

    events.on('select.separate', async () => {
        await performSelectionFunc('separate');
    });

    // GLB模型复制事件处理
    events.on('model.duplicate', (model) => {
        try {
            console.log('开始复制GLB模型:', model.filename);

            // 创建模型的副本
            const duplicatedModel = duplicateGltfModel(model, scene);

            if (duplicatedModel) {
                // 先清空当前选择
                events.fire('selection', null);

                // 强制刷新场景
                scene.forceRender = true;

                // 延迟选中新模型，确保清空选择后再选中
                setTimeout(() => {
                    scene.forceRender = true;

                    // 选中新复制的模型
                    events.fire('selection', duplicatedModel);
                    console.log('GLB模型复制完成，新模型名称:', duplicatedModel.filename);
                }, 150);
            }
        } catch (error) {
            console.error('GLB模型复制失败:', error);
        }
    });

    // 监听模型移动事件，确保渲染刷新
    events.on('model.moved', (model) => {
        // 强制渲染刷新，确保原位和移动后的模型都正确显示
        scene.forceRender = true;

        // 延迟额外刷新，确保显示正确
        setTimeout(() => {
            scene.forceRender = true;
        }, 50);
    });

    events.on('scene.reset', () => {
        selectedSplats().forEach((splat) => {
            editHistory.add(new ResetOp(splat));
        });
    });

    const setAllData = (value: boolean) => {
        if (value !== scene.assetLoader.loadAllData) {
            scene.assetLoader.loadAllData = value;
            events.fire('allData', scene.assetLoader.loadAllData);
        }
    };

    events.function('allData', () => {
        return scene.assetLoader.loadAllData;
    });

    events.on('toggleAllData', (value: boolean) => {
        setAllData(!events.invoke('allData'));
    });

    // camera mode

    let activeMode = 'centers';

    const setCameraMode = (mode: string) => {
        if (mode !== activeMode) {
            activeMode = mode;
            events.fire('camera.mode', activeMode);
        }
    };

    events.function('camera.mode', () => {
        return activeMode;
    });

    events.on('camera.setMode', (mode: string) => {
        setCameraMode(mode);
    });

    events.on('camera.toggleMode', () => {
        setCameraMode(events.invoke('camera.mode') === 'centers' ? 'rings' : 'centers');
    });

    // camera overlay

    let cameraOverlay = scene.config.camera.overlay;

    const setCameraOverlay = (enabled: boolean) => {
        if (enabled !== cameraOverlay) {
            cameraOverlay = enabled;
            events.fire('camera.overlay', cameraOverlay);
        }
    };

    events.function('camera.overlay', () => {
        return cameraOverlay;
    });

    events.on('camera.setOverlay', (value: boolean) => {
        setCameraOverlay(value);
    });

    events.on('camera.toggleOverlay', () => {
        setCameraOverlay(!events.invoke('camera.overlay'));
    });

    // splat size

    let splatSize = 2;

    const setSplatSize = (value: number) => {
        if (value !== splatSize) {
            splatSize = value;
            events.fire('camera.splatSize', splatSize);
        }
    };

    events.function('camera.splatSize', () => {
        return splatSize;
    });

    events.on('camera.setSplatSize', (value: number) => {
        setSplatSize(value);
    });

    // camera fly speed

    const setFlySpeed = (value: number) => {
        if (value !== scene.camera.flySpeed) {
            scene.camera.flySpeed = value;
            events.fire('camera.flySpeed', value);
        }
    };

    events.function('camera.flySpeed', () => {
        return scene.camera.flySpeed;
    });

    events.on('camera.setFlySpeed', (value: number) => {
        setFlySpeed(value);
    });

    // outline selection

    let outlineSelection = false;

    const setOutlineSelection = (value: boolean) => {
        if (value !== outlineSelection) {
            outlineSelection = value;
            events.fire('view.outlineSelection', outlineSelection);
        }
    };

    events.function('view.outlineSelection', () => {
        return outlineSelection;
    });

    events.on('view.setOutlineSelection', (value: boolean) => {
        setOutlineSelection(value);
    });

    // view spherical harmonic bands

    let viewBands = scene.config.show.shBands;

    const setViewBands = (value: number) => {
        if (value !== viewBands) {
            viewBands = value;
            events.fire('view.bands', viewBands);
        }
    };

    events.function('view.bands', () => {
        return viewBands;
    });

    events.on('view.setBands', (value: number) => {
        setViewBands(value);
    });

    events.function('camera.getPose', () => {
        const camera = scene.camera;
        const position = camera.entity.getPosition();
        const focalPoint = camera.focalPoint;
        return {
            position: { x: position.x, y: position.y, z: position.z },
            target: { x: focalPoint.x, y: focalPoint.y, z: focalPoint.z }
        };
    });

    events.on('camera.setPose', (pose: { position: Vec3, target: Vec3 }, speed = 1) => {
        scene.camera.setPose(pose.position, pose.target, speed);
    });

    // hack: fire events to initialize UI
    events.fire('camera.fov', scene.camera.fov);
    events.fire('camera.overlay', cameraOverlay);
    events.fire('view.bands', viewBands);

    // doc serialization
    events.function('docSerialize.view', () => {
        const packC = (c: Color) => [c.r, c.g, c.b, c.a];
        return {
            bgColor: packC(events.invoke('bgClr')),
            selectedColor: packC(events.invoke('selectedClr')),
            unselectedColor: packC(events.invoke('unselectedClr')),
            lockedColor: packC(events.invoke('lockedClr')),
            shBands: events.invoke('view.bands'),
            centersSize: events.invoke('camera.splatSize'),
            outlineSelection: events.invoke('view.outlineSelection'),
            showGrid: events.invoke('grid.visible'),
            showBound: events.invoke('camera.bound'),
            flySpeed: events.invoke('camera.flySpeed')
        };
    });

    events.function('docDeserialize.view', (docView: any) => {
        events.fire('setBgClr', new Color(docView.bgColor));
        events.fire('setSelectedClr', new Color(docView.selectedColor));
        events.fire('setUnselectedClr', new Color(docView.unselectedColor));
        events.fire('setLockedClr', new Color(docView.lockedColor));
        events.fire('view.setBands', docView.shBands);
        events.fire('camera.setSplatSize', docView.centersSize);
        events.fire('view.setOutlineSelection', docView.outlineSelection);
        events.fire('grid.setVisible', docView.showGrid);
        events.fire('camera.setBound', docView.showBound);
        events.fire('camera.setFlySpeed', docView.flySpeed);
    });
};

export { registerEditorEvents };
