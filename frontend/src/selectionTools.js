import * as THREE from 'three';
import {
    acceleratedRaycast,
    computeBoundsTree,
    disposeBoundsTree,
    CONTAINED,
    INTERSECTED,
    NOT_INTERSECTED
} from 'three-mesh-bvh';

export const SELECTION_MODE_DEFAULTS = {
    enabled: false,
    mode: 'box',
    visibleOnly: true,
    brushRadius: 0.1,
    bucketSelectComponent: true
};

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

function pointInPolygon2D(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];
        const intersects = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

export function createSelectionHelpers({ container, getCamera, raycaster, mouse }) {
    const tempVec3A = new THREE.Vector3();
    const tempVec3B = new THREE.Vector3();
    const tempVec3C = new THREE.Vector3();
    const tempVec3D = new THREE.Vector3();
    const tempMatrix = new THREE.Matrix4();
    const tempBox = new THREE.Box3();
    const tempSphere = new THREE.Sphere();

    function setMouseFromLocal(localX, localY) {
        const rect = container.getBoundingClientRect();
        mouse.x = (localX / rect.width) * 2 - 1;
        mouse.y = -(localY / rect.height) * 2 + 1;
        return rect;
    }

    function getBrushRadiusPixels(radiusSetting = SELECTION_MODE_DEFAULTS.brushRadius) {
        const rect = container.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        return Math.max(6, Number(radiusSetting || 0.1) * size * 0.2);
    }

    function projectWorldToScreen(world, rect, out = tempVec3D) {
        out.copy(world).project(getCamera());
        return {
            x: ((out.x + 1) * 0.5) * rect.width,
            y: ((-out.y + 1) * 0.5) * rect.height,
            depth: out.z
        };
    }

    function getGeometryFaceCount(geometry) {
        if (!geometry) return 0;
        if (geometry.index) return Math.floor(geometry.index.count / 3);
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) return 0;
        return Math.floor(posAttr.count / 3);
    }

    function getGeometryFaceVertexIndices(geometry, faceIndex) {
        if (geometry.index) {
            const idx = geometry.index.array;
            const start = faceIndex * 3;
            return [idx[start], idx[start + 1], idx[start + 2]];
        }
        const start = faceIndex * 3;
        return [start, start + 1, start + 2];
    }

    function getTopologyFaceVertexIndices(objData, faceIndex) {
        const geometry = objData?.object?.geometry;
        if (geometry?.index && !(objData?.data?.face_colors)) {
            return getGeometryFaceVertexIndices(geometry, faceIndex);
        }
        if (objData?.data?.faces && Array.isArray(objData.data.faces[faceIndex])) {
            return objData.data.faces[faceIndex];
        }
        return getGeometryFaceVertexIndices(geometry, faceIndex);
    }

    function getDataFaceVertexIndices(objData, faceIndex) {
        return getGeometryFaceVertexIndices(objData.object.geometry, faceIndex);
    }

    function getFaceCentroidWorld(objData, faceIndex, out = tempVec3A) {
        const geometry = objData.object.geometry;
        const posAttr = geometry.getAttribute('position');
        const faceVerts = getGeometryFaceVertexIndices(geometry, faceIndex);
        tempVec3A.set(
            posAttr.array[faceVerts[0] * 3],
            posAttr.array[faceVerts[0] * 3 + 1],
            posAttr.array[faceVerts[0] * 3 + 2]
        );
        tempVec3B.set(
            posAttr.array[faceVerts[1] * 3],
            posAttr.array[faceVerts[1] * 3 + 1],
            posAttr.array[faceVerts[1] * 3 + 2]
        );
        tempVec3C.set(
            posAttr.array[faceVerts[2] * 3],
            posAttr.array[faceVerts[2] * 3 + 1],
            posAttr.array[faceVerts[2] * 3 + 2]
        );
        out.copy(tempVec3A).add(tempVec3B).add(tempVec3C).multiplyScalar(1 / 3);
        out.applyMatrix4(objData.object.matrixWorld);
        return out;
    }

    function getPointWorldPosition(objData, pointIndex, out = tempVec3A) {
        objData.object.getMatrixAt(pointIndex, tempMatrix);
        out.setFromMatrixPosition(tempMatrix);
        out.applyMatrix4(objData.object.matrixWorld);
        return out;
    }

    function pointInsideSelectionRegion(x, y, region) {
        if (!region) return false;
        if (region.type === 'box') {
            return x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
        }
        if (region.type === 'lasso') {
            return pointInPolygon2D(x, y, region.points);
        }
        return false;
    }

    function ensureMeshBVH(objData) {
        if (!objData || objData.type !== 'mesh') return false;
        const geometry = objData.object?.geometry;
        if (!geometry || !geometry.getAttribute('position')) return false;
        if (!geometry.boundsTree && typeof geometry.computeBoundsTree === 'function') {
            geometry.computeBoundsTree({ indirect: true });
        }
        return Boolean(geometry.boundsTree);
    }

    function invalidateMeshBVH(objData) {
        if (!objData || objData.type !== 'mesh') return;
        const geometry = objData.object?.geometry;
        if (!geometry || !geometry.boundsTree) return;
        if (typeof geometry.disposeBoundsTree === 'function') {
            geometry.disposeBoundsTree();
        } else {
            geometry.boundsTree = null;
        }
    }

    function raycastObjectFromLocal(objData, localX, localY, options = {}) {
        const { firstHitOnly = false, ensureBVH = true, useBVH = true } = options;
        const geometry = objData.object?.geometry;
        let hadBoundsTree = false;
        let savedBoundsTree = null;

        if (objData.type === 'mesh' && ensureBVH && useBVH) {
            ensureMeshBVH(objData);
        }
        if (objData.type === 'mesh' && !useBVH && geometry && geometry.boundsTree) {
            hadBoundsTree = true;
            savedBoundsTree = geometry.boundsTree;
            geometry.boundsTree = null;
        }

        setMouseFromLocal(localX, localY);
        raycaster.setFromCamera(mouse, getCamera());
        const prevFirstHitOnly = raycaster.firstHitOnly;
        let intersects = [];
        try {
            raycaster.firstHitOnly = !!firstHitOnly;
            intersects = raycaster.intersectObject(objData.object, false);
        } finally {
            raycaster.firstHitOnly = prevFirstHitOnly;
            if (hadBoundsTree && geometry) {
                geometry.boundsTree = savedBoundsTree;
            }
        }
        if (!intersects.length) return null;

        if (objData.type === 'mesh') {
            const hit = intersects.find(intx => intx.faceIndex !== undefined && Number.isFinite(intx.faceIndex));
            return hit || null;
        }

        if (objData.type === 'points') {
            const hit = intersects.find(intx => intx.instanceId !== undefined && intx.instanceId !== null);
            return hit || null;
        }

        return intersects[0];
    }

    function raycastObjectFromClient(objData, clientX, clientY, options = {}) {
        const rect = container.getBoundingClientRect();
        return raycastObjectFromLocal(objData, clientX - rect.left, clientY - rect.top, options);
    }

    function collectBrushRayHits(objData, clientX, clientY, radiusSetting = SELECTION_MODE_DEFAULTS.brushRadius) {
        const rect = container.getBoundingClientRect();
        const centerX = clientX - rect.left;
        const centerY = clientY - rect.top;
        const radiusPx = getBrushRadiusPixels(radiusSetting);
        const sampleStep = Math.max(2, radiusPx / 5);
        const radiusSq = radiusPx * radiusPx;
        const faceIndices = new Set();
        const pointIndices = new Set();

        const minX = centerX - radiusPx;
        const maxX = centerX + radiusPx;
        const minY = centerY - radiusPx;
        const maxY = centerY + radiusPx;

        for (let y = minY; y <= maxY; y += sampleStep) {
            for (let x = minX; x <= maxX; x += sampleStep) {
                const dx = x - centerX;
                const dy = y - centerY;
                if ((dx * dx + dy * dy) > radiusSq) continue;
                const hit = raycastObjectFromLocal(objData, x, y, { firstHitOnly: objData.type === 'mesh' });
                if (!hit) continue;

                if (objData.type === 'mesh' && hit.faceIndex !== undefined) {
                    faceIndices.add(hit.faceIndex);
                } else if (objData.type === 'points' && hit.instanceId !== undefined) {
                    pointIndices.add(hit.instanceId);
                }
            }
        }

        return { faceIndices, pointIndices };
    }

    function computeBrushSphereLocal(objData, worldPoint, radiusSetting = SELECTION_MODE_DEFAULTS.brushRadius) {
        const rect = container.getBoundingClientRect();
        const radiusPx = getBrushRadiusPixels(radiusSetting);
        if (!Number.isFinite(radiusPx) || radiusPx <= 0) return null;

        const camera = getCamera();
        tempVec3A.copy(worldPoint).project(camera);
        const xNdcOffset = (radiusPx / Math.max(1, rect.width)) * 2;
        tempVec3B.set(tempVec3A.x + xNdcOffset, tempVec3A.y, tempVec3A.z).unproject(camera);

        tempMatrix.copy(objData.object.matrixWorld).invert();
        tempVec3C.copy(worldPoint).applyMatrix4(tempMatrix);
        tempVec3D.copy(tempVec3B).applyMatrix4(tempMatrix);

        const localRadius = tempVec3C.distanceTo(tempVec3D);
        if (!Number.isFinite(localRadius) || localRadius <= 0) return null;

        tempSphere.center.copy(tempVec3C);
        tempSphere.radius = localRadius;
        return tempSphere;
    }

    function collectBrushFacesWithBVH(objData, clientX, clientY, radiusSetting = SELECTION_MODE_DEFAULTS.brushRadius) {
        if (!ensureMeshBVH(objData)) return new Set();

        const hit = raycastObjectFromClient(objData, clientX, clientY, { firstHitOnly: true });
        if (!hit || hit.faceIndex === undefined || !Number.isFinite(hit.faceIndex)) {
            return new Set();
        }

        const sphere = computeBrushSphereLocal(objData, hit.point, radiusSetting);
        if (!sphere) return new Set();

        const geometry = objData.object.geometry;
        const bvh = geometry?.boundsTree;
        if (!bvh) return new Set();

        const selectedFaces = new Set();
        bvh.shapecast({
            intersectsBounds: (box) => {
                if (!sphere.intersectsBox(box)) return NOT_INTERSECTED;

                tempBox.copy(box);
                const { min, max } = tempBox;
                for (let x = 0; x <= 1; x += 1) {
                    for (let y = 0; y <= 1; y += 1) {
                        for (let z = 0; z <= 1; z += 1) {
                            tempVec3A.set(
                                x === 0 ? min.x : max.x,
                                y === 0 ? min.y : max.y,
                                z === 0 ? min.z : max.z
                            );
                            if (!sphere.containsPoint(tempVec3A)) {
                                return INTERSECTED;
                            }
                        }
                    }
                }
                return CONTAINED;
            },
            intersectsTriangle: (triangle, triangleIndex, contained) => {
                if (contained || triangle.intersectsSphere(sphere)) {
                    selectedFaces.add(triangleIndex);
                }
                return false;
            }
        });

        return selectedFaces;
    }

    function collectAllMeshSelection(objData) {
        const geometry = objData.object.geometry;
        const faceCount = getGeometryFaceCount(geometry);
        const faceIndices = [];
        const vertexIndices = new Set();
        for (let i = 0; i < faceCount; i += 1) {
            faceIndices.push(i);
            const verts = getDataFaceVertexIndices(objData, i);
            vertexIndices.add(verts[0]);
            vertexIndices.add(verts[1]);
            vertexIndices.add(verts[2]);
        }
        return {
            faceIndices,
            vertexIndices: Array.from(vertexIndices)
        };
    }

    function collectAllPointsSelection(objData) {
        const count = objData.object.count || 0;
        const pointIndices = [];
        for (let i = 0; i < count; i += 1) pointIndices.push(i);
        return { pointIndices };
    }

    function collectRegionSelectionMesh(objData, region, visibleOnly = true) {
        const geometry = objData.object.geometry;
        const faceCount = getGeometryFaceCount(geometry);
        const rect = container.getBoundingClientRect();
        const faceIndices = [];
        const vertexIndices = new Set();
        const enforceVisibility = !!visibleOnly;

        if (enforceVisibility) {
            ensureMeshBVH(objData);
        }

        for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
            const centroid = getFaceCentroidWorld(objData, faceIndex, tempVec3A);
            const screen = projectWorldToScreen(centroid, rect, tempVec3D);
            if (screen.depth < -1 || screen.depth > 1) continue;
            if (!pointInsideSelectionRegion(screen.x, screen.y, region)) continue;
            if (enforceVisibility) {
                const hit = raycastObjectFromLocal(objData, screen.x, screen.y, { firstHitOnly: true });
                if (!hit || hit.faceIndex !== faceIndex) continue;
            }
            faceIndices.push(faceIndex);
            const faceVerts = getDataFaceVertexIndices(objData, faceIndex);
            vertexIndices.add(faceVerts[0]);
            vertexIndices.add(faceVerts[1]);
            vertexIndices.add(faceVerts[2]);
        }

        return {
            faceIndices,
            vertexIndices: Array.from(vertexIndices)
        };
    }

    function collectRegionSelectionPoints(objData, region, visibleOnly = true) {
        void visibleOnly;
        const pointIndices = [];
        const rect = container.getBoundingClientRect();

        for (let i = 0; i < objData.object.count; i += 1) {
            const world = getPointWorldPosition(objData, i, tempVec3A);
            const screen = projectWorldToScreen(world, rect, tempVec3D);
            if (!pointInsideSelectionRegion(screen.x, screen.y, region)) continue;
            pointIndices.push(i);
        }

        return { pointIndices };
    }

    function collectBrushSelection(objData, clientX, clientY, radius, targetSelection) {
        if (objData.type === 'mesh') {
            const brushFaces = collectBrushFacesWithBVH(objData, clientX, clientY, radius);
            brushFaces.forEach(faceIndex => {
                targetSelection.faceIndices.add(faceIndex);
                const faceVerts = getDataFaceVertexIndices(objData, faceIndex);
                targetSelection.vertexIndices.add(faceVerts[0]);
                targetSelection.vertexIndices.add(faceVerts[1]);
                targetSelection.vertexIndices.add(faceVerts[2]);
            });
            return;
        }
        if (objData.type === 'points') {
            const brushHits = collectBrushRayHits(objData, clientX, clientY, radius);
            brushHits.pointIndices.forEach(pointIndex => {
                targetSelection.pointIndices.add(pointIndex);
            });
        }
    }

    function collectBucketSelection(objData, clientX, clientY, bucketSelectComponent = true) {
        if (objData.type === 'mesh') {
            if (!bucketSelectComponent) {
                return collectAllMeshSelection(objData);
            }

            const hit = raycastObjectFromClient(objData, clientX, clientY, {
                ensureBVH: false,
                useBVH: false
            });
            if (!hit || hit.faceIndex === undefined) {
                return { faceIndices: [], vertexIndices: [] };
            }

            const geometry = objData.object.geometry;
            const faceCount = getGeometryFaceCount(geometry);
            const vertexToFaces = new Map();
            for (let fi = 0; fi < faceCount; fi += 1) {
                const [a, b, c] = getTopologyFaceVertexIndices(objData, fi);
                if (!vertexToFaces.has(a)) vertexToFaces.set(a, []);
                if (!vertexToFaces.has(b)) vertexToFaces.set(b, []);
                if (!vertexToFaces.has(c)) vertexToFaces.set(c, []);
                vertexToFaces.get(a).push(fi);
                vertexToFaces.get(b).push(fi);
                vertexToFaces.get(c).push(fi);
            }

            const seedFace = hit.faceIndex;
            const stack = [seedFace];
            const visitedFaces = new Set();
            while (stack.length) {
                const faceIndex = stack.pop();
                if (visitedFaces.has(faceIndex)) continue;
                visitedFaces.add(faceIndex);
                const [a, b, c] = getTopologyFaceVertexIndices(objData, faceIndex);
                const neighbors = [
                    ...(vertexToFaces.get(a) || []),
                    ...(vertexToFaces.get(b) || []),
                    ...(vertexToFaces.get(c) || [])
                ];
                for (const n of neighbors) {
                    if (!visitedFaces.has(n)) stack.push(n);
                }
            }

            const vertexIndices = new Set();
            visitedFaces.forEach(faceIndex => {
                const verts = getDataFaceVertexIndices(objData, faceIndex);
                vertexIndices.add(verts[0]);
                vertexIndices.add(verts[1]);
                vertexIndices.add(verts[2]);
            });

            return {
                faceIndices: Array.from(visitedFaces),
                vertexIndices: Array.from(vertexIndices)
            };
        }

        if (objData.type === 'points') {
            if (!bucketSelectComponent) {
                return collectAllPointsSelection(objData);
            }
            const hit = raycastObjectFromClient(objData, clientX, clientY);
            if (!hit || hit.instanceId === undefined) {
                return { pointIndices: [] };
            }
            return { pointIndices: [hit.instanceId] };
        }

        return null;
    }

    return {
        getBrushRadiusPixels,
        getGeometryFaceCount,
        getGeometryFaceVertexIndices,
        getTopologyFaceVertexIndices,
        getDataFaceVertexIndices,
        getFaceCentroidWorld,
        getPointWorldPosition,
        ensureMeshBVH,
        invalidateMeshBVH,
        pointInsideSelectionRegion,
        raycastObjectFromLocal,
        raycastObjectFromClient,
        collectAllMeshSelection,
        collectAllPointsSelection,
        collectRegionSelectionMesh,
        collectRegionSelectionPoints,
        collectBrushSelection,
        collectBucketSelection
    };
}
