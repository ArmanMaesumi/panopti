import * as THREE from 'three';

function isSliceableObjectType(type) {
    return type === 'mesh' || type === 'animated_mesh' || type === 'points';
}

function forEachObjectMaterial(objData, callback) {
    if (!objData || !objData.object) return;

    const apply = (material) => {
        if (!material) return;
        if (Array.isArray(material)) {
            material.forEach(mat => mat && callback(mat));
        } else {
            callback(material);
        }
    };

    apply(objData.object.material);
    const wireframeHelper = objData.object.userData?.wireframeHelper;
    if (wireframeHelper && wireframeHelper.material) {
        apply(wireframeHelper.material);
    }
}

export class SlicingPlaneController {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;

        this.enabled = false;
        this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.handle = new THREE.Object3D();
        this.mesh = null;
        this.outline = null;

        const planeGeometry = new THREE.PlaneGeometry(1, 1);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25,
            depthWrite: false
        });

        this.mesh = new THREE.Mesh(planeGeometry, planeMaterial);
        this.mesh.visible = false;
        this.mesh.renderOrder = 995;

        this.outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeometry),
            new THREE.LineBasicMaterial({
                color: 0x0ea5e9,
                transparent: true,
                opacity: 0.9
            })
        );
        this.mesh.add(this.outline);
        this.handle.add(this.mesh);
        this.scene.add(this.handle);

        this.renderer.localClippingEnabled = false;
    }

    isEnabled() {
        return this.enabled;
    }

    getHandle() {
        return this.handle;
    }

    isHandle(object) {
        return object === this.handle;
    }

    setEnabled(enabled) {
        const nextEnabled = !!enabled;
        if (this.enabled === nextEnabled) return false;

        this.enabled = nextEnabled;
        this.mesh.visible = nextEnabled;
        this.renderer.localClippingEnabled = nextEnabled;
        return true;
    }

    syncPlaneFromHandle() {
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();
        const planeNormal = new THREE.Vector3(0, 0, 1);

        this.handle.getWorldPosition(worldPosition);
        this.handle.getWorldQuaternion(worldQuaternion);
        planeNormal.applyQuaternion(worldQuaternion).normalize();
        this.plane.setFromNormalAndCoplanarPoint(planeNormal, worldPosition);
    }

    centerOnObject(targetObject, resetOrientation = false) {
        if (!targetObject) return false;

        const bounds = new THREE.Box3().setFromObject(targetObject);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();

        if (!bounds.isEmpty()) {
            bounds.getCenter(center);
            bounds.getSize(size);
        } else {
            targetObject.getWorldPosition(center);
            size.set(1, 1, 1);
        }

        this.handle.position.copy(center);
        if (resetOrientation) {
            this.handle.quaternion.identity();
            this.handle.scale.set(1, 1, 1);
        }

        const visualSize = Math.max(size.x, size.y, size.z, 1) * 1.2;
        this.mesh.scale.set(visualSize, visualSize, 1);
        this.syncPlaneFromHandle();
        return true;
    }

    resetToDefault() {
        this.handle.position.set(0, 0, 0);
        this.handle.quaternion.identity();
        this.handle.scale.set(1, 1, 1);
        this.mesh.scale.set(2, 2, 1);
        this.syncPlaneFromHandle();
    }

    applyToObject(objData, selectedObjectId = null) {
        if (!objData || !isSliceableObjectType(objData.type)) return;

        const shouldSlice = Boolean(
            this.enabled &&
            selectedObjectId &&
            objData.data &&
            objData.data.id === selectedObjectId
        );
        const clippingPlanes = shouldSlice ? [this.plane] : null;

        forEachObjectMaterial(objData, (material) => {
            material.clippingPlanes = clippingPlanes;
            material.clipShadows = shouldSlice;
            material.needsUpdate = true;
        });
    }

    applyToObjects(objectsById, selectedObjectId = null) {
        Object.values(objectsById).forEach((objData) => {
            this.applyToObject(objData, selectedObjectId);
        });
    }

    dispose() {
        if (this.handle.parent) {
            this.handle.parent.remove(this.handle);
        }

        if (this.outline) {
            if (this.outline.geometry) {
                this.outline.geometry.dispose();
            }
            if (this.outline.material) {
                this.outline.material.dispose();
            }
            this.outline = null;
        }

        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
            }
            if (this.mesh.material) {
                this.mesh.material.dispose();
            }
            this.mesh = null;
        }
    }
}
