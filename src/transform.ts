import { Quat, Vec3 } from 'playcanvas';

// 变换类，包含位置、旋转和缩放信息
class Transform {
    position = new Vec3();      // 位置向量
    rotation = new Quat();      // 旋转四元数
    scale = new Vec3(1, 1, 1);  // 缩放向量

    constructor(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        this.set(position, rotation, scale);
    }

    // 设置变换参数
    set(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) {
            this.position.copy(position);
        }
        if (rotation) {
            this.rotation.copy(rotation);
        }
        if (scale) {
            this.scale.copy(scale);
        }
    }

    // 复制其他变换的值
    copy(transform: Transform) {
        this.position.copy(transform.position);
        this.rotation.copy(transform.rotation);
        this.scale.copy(transform.scale);
    }

    // 克隆当前变换
    clone() {
        return new Transform(this.position.clone(), this.rotation.clone(), this.scale.clone());
    }

    // 精确比较两个变换是否相等
    equals(transform: Transform) {
        return this.position.equals(transform.position) &&
               this.rotation.equals(transform.rotation) &&
               this.scale.equals(transform.scale);
    }

    // 近似比较两个变换是否相等
    equalsApprox(transform: Transform, epsilon = 1e-6) {
        return this.position.equalsApprox(transform.position, epsilon) &&
               this.rotation.equalsApprox(transform.rotation, epsilon) &&
               this.scale.equalsApprox(transform.scale, epsilon);
    }

    // 比较变换与给定的TRS参数是否相等
    equalsTRS(position: Vec3, rotation: Quat, scale: Vec3) {
        return this.position.equals(position) &&
               this.rotation.equals(rotation) &&
               this.scale.equals(scale);
    }

    equalsApproxTRS(position: Vec3, rotation: Quat, scale: Vec3, epsilon = 1e-6) {
        return this.position.equalsApprox(position, epsilon) &&
               this.rotation.equalsApprox(rotation, epsilon) &&
               this.scale.equalsApprox(scale, epsilon);
    }
}

export { Transform };
