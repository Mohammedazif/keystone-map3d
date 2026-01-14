// Helper for text labels  
const createTextSprite = (THREE: any, text: string, color: string = '#000000', fontsize: number = 24) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `bold ${fontsize}px Arial`;
    const metrics = ctx.measureText(text);
    const width = metrics.width;

    canvas.width = width + 20;
    canvas.height = fontsize + 20;

    ctx.font = `bold ${fontsize}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;

    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);

    const scale = fontsize * 0.1 * (50 / 50);
    sprite.scale.set(scale * (width / fontsize), scale, 1);
    return sprite;
};

export function createShaktiChakraGroup(THREE: any, radius: number = 50) {
    const group = new THREE.Group();
    group.name = 'vastu-shakti-chakra';

    // 1. Base circle
    const baseGeometry = new THREE.CircleGeometry(radius, 64);
    const baseMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthTest: false
    });
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    group.add(baseMesh);

    // 2. Zone lines (32 zones = 32 radial lines)
    for (let i = 0; i < 32; i++) {
        const angle = (i * 11.25) * (Math.PI / 180);
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.3, depthTest: false });
        const line = new THREE.Line(geometry, material);
        group.add(line);
    }

    // 3. Concentric rings
    const rings = [0.25, 0.5, 0.75, 1.0];
    rings.forEach(r => {
        const ringGeometry = new THREE.RingGeometry(radius * r - 0.5, radius * r + 0.5, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x666666,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            depthTest: false
        });
        const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        group.add(ringMesh);
    });

    // 4. Direction Markers & Labels
    // Threebox: X = East/West, Y = North/South, Z = altitude
    // BUT: Angles need to be flipped 180° to match Mapbox compass direction
    const directions = [
        { label: 'N', angle: -Math.PI / 2, color: '#FF0000' },        // -90° (was 90°)
        { label: 'E', angle: Math.PI, color: '#000000' },             // 180° (was 0°)
        { label: 'S', angle: Math.PI / 2, color: '#000000' },         // 90° (was -90°)
        { label: 'W', angle: 0, color: '#000000' },                   // 0° (was 180°)
        { label: 'NE', angle: -Math.PI / 4 + Math.PI, color: '#666666' },    // 135° (was 45°)
        { label: 'SE', angle: Math.PI / 4 + Math.PI, color: '#666666' },     // 225° (was -45°)
        { label: 'SW', angle: Math.PI / 4, color: '#666666' },                // 45° (was -135°)
        { label: 'NW', angle: -Math.PI / 4, color: '#666666' }                // -45° or 315° (was 135°)
    ];

    directions.forEach(dir => {
        const label = createTextSprite(THREE, dir.label, dir.label === 'N' ? '#D62828' : '#000000', 48);
        if (label) {
            const rLabel = radius * 1.25;
            const x = Math.cos(dir.angle) * rLabel;
            const y = Math.sin(dir.angle) * rLabel;

            if (['N', 'E', 'S', 'W'].includes(dir.label)) {
                console.log(`🧭 ${dir.label}: angle=${(dir.angle * 180 / Math.PI).toFixed(0)}°, pos=(${x.toFixed(2)}, ${y.toFixed(2)}, 0)`);
            }

            label.position.set(x, y, 0);
            group.add(label);
        }
    });

    // No rotation needed! CircleGeometry is in XY plane, which matches Threebox perfectly:
    // X = East/West (longitude), Y = North/South (latitude), Z = altitude
    // Our labels: N at (0,+Y), E at (+X,0), S at (0,-Y), W at (-X,0) - perfect!
    console.log('🧭 Vastu Compass: No rotation applied. Labels aligned with Threebox XY plane.');

    return group;
}

export const VASTU_ZONES = [
    'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8',
    'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
    'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'
];
