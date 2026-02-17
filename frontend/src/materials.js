/**
 * This module handles parses material classes from backend and creates
 * their corresponding Three.js material objects.
 */

import * as THREE from 'three';

/**
 * Parse color from various formats (RGB array, hex string, etc.)
 * @param {Array|string} color - Color in RGB array [r,g,b] or hex string "#RRGGBB"
 * @returns {THREE.Color} Three.js Color object
 */
function parseColor(color) {
    const fromRgbArray = (rgb) => {
        const [r, g, b] = rgb;
        const isDisplaySpaceRGB =
            Number.isFinite(r) &&
            Number.isFinite(g) &&
            Number.isFinite(b) &&
            r >= 0 && r <= 1 &&
            g >= 0 && g <= 1 &&
            b >= 0 && b <= 1;

        if (isDisplaySpaceRGB) {
            return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
        }
        return new THREE.Color(r, g, b);
    };

    if (typeof color === 'string') {
        return new THREE.Color(color);
    } else if (Array.isArray(color)) {
        return fromRgbArray(color);
    }
    return new THREE.Color(0xffffff);
}

/**
 * Parse side rendering mode
 * @param {string} side - Side mode: "front", "back", or "double"
 * @returns {number} Three.js side constant
 */
function parseSide(side) {
    switch (side) {
        case 'front': return THREE.FrontSide;
        case 'back': return THREE.BackSide;
        case 'double': return THREE.DoubleSide;
        default: return THREE.FrontSide;
    }
}

/**
 * Parse blending mode
 * @param {string} blending - Blending mode
 * @returns {number} Three.js blending constant
 */
function parseBlending(blending) {
    switch (blending) {
        case 'additive': return THREE.AdditiveBlending;
        case 'subtract': return THREE.SubtractiveBlending;
        case 'multiply': return THREE.MultiplyBlending;
        case 'normal':
        default: return THREE.NormalBlending;
    }
}

/**
 * Parse depth packing mode
 * @param {string} depth_packing - Depth packing mode
 * @returns {number} Three.js depth packing constant
 */
function parseDepthPacking(depth_packing) {
    switch (depth_packing) {
        case 'rgba': return THREE.RGBADepthPacking;
        case 'basic': return THREE.BasicDepthPacking;
        default: return THREE.BasicDepthPacking;
    }
}

/**
 * Apply common material properties to any Three.js material
 * @param {THREE.Material} material - The material to configure
 * @param {Object} materialData - Material data from backend
 */
function applyCommonProperties(material, materialData) {
    const commonProps = {
        flat_shading: (value) => material.flatShading = value,
        color: (value) => material.color = parseColor(value),
        opacity: (value) => {
            material.opacity = value;
            material.transparent = value < 1.0;
        },
        transparent: (value) => material.transparent = value,
        alpha_test: (value) => material.alphaTest = value,
        side: (value) => material.side = parseSide(value),
        wireframe: (value) => material.wireframe = value,
        wireframe_linewidth: (value) => material.wireframeLinewidth = value,
        depth_test: (value) => material.depthTest = value,
        depth_write: (value) => material.depthWrite = value,
        tone_mapped: (value) => material.toneMapped = value
    };
    
    // Apply each property if it exists in the data
    Object.entries(commonProps).forEach(([key, setter]) => {
        if (materialData[key] !== undefined) {
            setter(materialData[key]);
        }
    });
}

/**
 * Material property mappings for different material types
 */
const MATERIAL_PROPERTIES = {
    MeshStandardMaterial: {
        roughness: (material, value) => material.roughness = value,
        metalness: (material, value) => material.metalness = value,
        emissive: (material, value) => material.emissive = parseColor(value),
        emissive_intensity: (material, value) => material.emissiveIntensity = value,
    },
    
    MeshPhysicalMaterial: {
        // Inherit from MeshStandardMaterial
        roughness: (material, value) => material.roughness = value,
        metalness: (material, value) => material.metalness = value,
        emissive: (material, value) => material.emissive = parseColor(value),
        emissive_intensity: (material, value) => material.emissiveIntensity = value,
        
        // MeshPhysicalMaterial specific properties
        reflectivity: (material, value) => material.reflectivity = value,
        sheen: (material, value) => material.sheen = value,
        sheen_roughness: (material, value) => material.sheenRoughness = value,
        sheen_color: (material, value) => material.sheenColor = parseColor(value),
        specular_intensity: (material, value) => material.specularIntensity = value,
        specular_color: (material, value) => material.specularColor = parseColor(value),
        ior: (material, value) => material.ior = value,
        anisotropy: (material, value) => material.anisotropy = value,
        anisotropy_rotation: (material, value) => material.anisotropyRotation = value,
        iridescence: (material, value) => material.iridescence = value,
        iridescence_ior: (material, value) => material.iridescenceIOR = value,
        iridescence_thickness_range: (material, value) => material.iridescenceThicknessRange = value,
        clearcoat: (material, value) => material.clearcoat = value,
        clearcoat_roughness: (material, value) => material.clearcoatRoughness = value,
        transmission: (material, value) => material.transmission = value,
        thickness: (material, value) => material.thickness = value,
        attenuation_distance: (material, value) => material.attenuationDistance = value,
        attenuation_color: (material, value) => material.attenuationColor = parseColor(value)
    },
    
    MeshBasicMaterial: {
        // No additional properties beyond common ones
    },
    
    MeshToonMaterial: {
        emissive: (material, value) => material.emissive = parseColor(value),
        emissive_intensity: (material, value) => material.emissiveIntensity = value
    },
    
    MeshNormalMaterial: {
        // No additional properties beyond common ones
    },
    
    MeshDepthMaterial: {
        depth_packing: (material, value) => {
            material.depthPacking = parseDepthPacking(value);
        }
    }
};

/**
 * Create a Three.js material from material data
 * @param {Object} materialData - Material data from backend
 * @returns {THREE.Material} Three.js material
 */
export function createMaterial(materialData) {
    if (!materialData || !materialData.type) {
        // console.warn('No material data provided, using default MeshStandardMaterial');
        return new THREE.MeshStandardMaterial();
    }
    
    try {
        // Create the material instance
        const materialClass = THREE[materialData.type];
        if (!materialClass) {
            console.warn(`Unknown material type: ${materialData.type}, using MeshStandardMaterial`);
            return new THREE.MeshStandardMaterial();
        }
        
        const material = new materialClass();
        
        // Apply common properties
        applyCommonProperties(material, materialData);
        
        // Apply material-specific properties
        const specificProps = MATERIAL_PROPERTIES[materialData.type];
        if (specificProps) {
            Object.entries(specificProps).forEach(([key, setter]) => {
                if (materialData[key] !== undefined) {
                    setter(material, materialData[key]);
                }
            });
        }
        
        return material;
    } catch (error) {
        console.error('Error creating material:', error);
        console.warn('Falling back to default MeshStandardMaterial');
        return new THREE.MeshStandardMaterial();
    }
}

/**
 * Update an existing material with new properties
 * @param {THREE.Material} material - Existing Three.js material
 * @param {Object} materialData - New material data
 * @returns {THREE.Material} Updated material (may be a new instance if type changed)
 */
export function updateMaterial(material, materialData) {
    if (!materialData) return material;
    
    try {
        // Check if material type has changed
        const currentType = material.constructor.name;
        const newType = materialData.type;
        
        if (newType && newType !== currentType) {
            return createMaterial(materialData);
        }
        
        // Material type hasn't changed, update existing material
        // Update common properties
        applyCommonProperties(material, materialData);
        
        // Update material-specific properties based on type
        const specificProps = MATERIAL_PROPERTIES[currentType];
        
        if (specificProps) {
            Object.entries(specificProps).forEach(([key, setter]) => {
                if (materialData[key] !== undefined) {
                    setter(material, materialData[key]);
                }
            });
        }
        
        // Mark material as needing update
        material.needsUpdate = true;
        return material;
    } catch (error) {
        console.error('Error updating material:', error);
        return material;
    }
} 
