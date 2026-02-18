// Helper for text labels
const createTextSprite = (THREE: any, text: string, color: string = '#000000', fontsize: number = 24, bgColor?: string) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `bold ${fontsize}px Arial`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;

    const padding = 4;
    canvas.width = textWidth + padding * 2;
    canvas.height = fontsize + padding * 2;

    if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
    }

    ctx.font = `bold ${fontsize}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;

    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);

    const scale = fontsize * 0.1;
    sprite.scale.set(scale * (canvas.width / fontsize), scale, 1);
    return sprite;
};

export function createShaktiChakraGroup(THREE: any, radius: number = 50) {
    const group = new THREE.Group();
    group.name = 'vastu-shakti-chakra';

    // ─── COORDINATE SYSTEM (Threebox) ───────────────────────────────────────
    // X = East, Y = North, Z = altitude
    // angle 0 = East (+X), angle 90° = North (+Y)
    // To place at compass bearing B (0=N, 90=E, 180=S, 270=W):
    //   threeAngle = 90° - B  (in radians: Math.PI/2 - B_rad)
    // ────────────────────────────────────────────────────────────────────────

    // Threebox coordinate system: +X = West, +Y = South (both axes inverted vs standard math)
    // To correctly place compass bearings: angle = -(π/2 + bearing_rad)
    // Verification: N(0°)→-π/2→(0,-1)→-Y=North✓  E(90°)→-π→(-1,0)→-X=East✓
    //               S(180°)→π/2→(0,1)→+Y=South✓   W(270°)→0→(1,0)→+X=West✓
    const bearingToAngle = (bearingDeg: number) => -(Math.PI / 2 + bearingDeg * Math.PI / 180);

    // ─── 1. OUTER DEGREE TICK RING ───────────────────────────────────────────
    const outerR = radius * 1.55;
    const tickInnerR = radius * 1.35;
    const tickMajorR = radius * 1.55;  // every 10°
    const tickMinorR = radius * 1.42;  // every 5° (between 10° ticks)

    for (let deg = 0; deg < 360; deg += 5) {
        const isMajor = deg % 10 === 0;
        const angle = bearingToAngle(deg);
        const innerR = isMajor ? tickInnerR : (radius * 1.44);
        const outerRTick = isMajor ? tickMajorR : tickMinorR;

        const points = [
            new THREE.Vector3(Math.cos(angle) * innerR, Math.sin(angle) * innerR, 0),
            new THREE.Vector3(Math.cos(angle) * outerRTick, Math.sin(angle) * outerRTick, 0),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: isMajor ? 0x333333 : 0x888888,
            transparent: true,
            opacity: isMajor ? 0.7 : 0.4,
            depthTest: false
        });
        group.add(new THREE.Line(geo, mat));
    }

    // ─── 2. DEGREE NUMBER LABELS (every 10°) ────────────────────────────────
    const degLabelR = radius * 1.68;
    for (let deg = 0; deg < 360; deg += 10) {
        const angle = bearingToAngle(deg);
        const label = createTextSprite(THREE, `${deg}`, '#333333', 18);
        if (label) {
            label.position.set(
                Math.cos(angle) * degLabelR,
                Math.sin(angle) * degLabelR,
                0
            );
            group.add(label);
        }
    }

    // ─── 3. OUTER RING CIRCLE ────────────────────────────────────────────────
    const outerRingGeo = new THREE.RingGeometry(outerR - 0.5, outerR + 0.5, 128);
    const outerRingMat = new THREE.MeshBasicMaterial({
        color: 0x333333, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthTest: false
    });
    group.add(new THREE.Mesh(outerRingGeo, outerRingMat));

    // ─── 4. INNER RING CIRCLES (concentric) ──────────────────────────────────
    const ringRadii = [radius * 0.35, radius * 0.65, radius, radius * 1.2, radius * 1.35];
    ringRadii.forEach(r => {
        const rGeo = new THREE.RingGeometry(r - 0.4, r + 0.4, 128);
        const rMat = new THREE.MeshBasicMaterial({
            color: 0x555555, transparent: true, opacity: 0.3,
            side: THREE.DoubleSide, depthTest: false
        });
        group.add(new THREE.Mesh(rGeo, rMat));
    });

    // ─── 5. BASE FILL ─────────────────────────────────────────────────────────
    const baseFillGeo = new THREE.CircleGeometry(radius * 1.35, 128);
    const baseFillMat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF, transparent: true, opacity: 0.08,
        side: THREE.DoubleSide, depthTest: false
    });
    group.add(new THREE.Mesh(baseFillGeo, baseFillMat));

    // ─── 6. 32 RADIAL ZONE LINES (every 11.25°) ──────────────────────────────
    for (let i = 0; i < 32; i++) {
        const bearingDeg = i * 11.25;
        const angle = bearingToAngle(bearingDeg);
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * 1.35, 0)
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: 0x666666, transparent: true, opacity: 0.35, depthTest: false
        });
        group.add(new THREE.Line(geo, mat));
    }

    // ─── 7. VASTU ZONE LABELS (N1-N8, E1-E8, S1-S8, W1-W8) ─────────────────
    // 32 zones, each 11.25° wide. Zone centers:
    // N zones: N1=337.5+5.625=343.125, N2=354.375, N3=5.625, N4=16.875, N5=28.125, N6=39.375, N7=50.625, N8=61.875
    // Actually: N1 starts at 337.5° (bearing), zones go clockwise
    // Standard Vastu: N1 at 337.5°, N2 at 348.75°, N3 at 360°/0°, N4 at 11.25°, N5 at 22.5°, N6 at 33.75°, N7 at 45°, N8 at 56.25°
    // E1 at 67.5°, E2 at 78.75°, ... E8 at 123.75°
    // S1 at 135°, ... S8 at 191.25°
    // W1 at 202.5°, ... W8 at 258.75°
    // Then back to N1 at 270°? No — standard Vastu 32 padas:
    // Starting from N (0°/360°), going clockwise:
    // N1=337.5, N2=348.75, N3=0, N4=11.25, N5=22.5, N6=33.75, N7=45, N8=56.25
    // E1=67.5, E2=78.75, E3=90, E4=101.25, E5=112.5, E6=123.75, E7=135, E8=146.25
    // S1=157.5, S2=168.75, S3=180, S4=191.25, S5=202.5, S6=213.75, S7=225, S8=236.25
    // W1=247.5, W2=258.75, W3=270, W4=281.25, W5=292.5, W6=303.75, W7=315, W8=326.25

    const zones = [
        // N zones (337.5° to 56.25°)
        { label: 'N1', startBearing: 337.5 },
        { label: 'N2', startBearing: 348.75 },
        { label: 'N3', startBearing: 0 },
        { label: 'N4', startBearing: 11.25 },
        { label: 'N5', startBearing: 22.5 },
        { label: 'N6', startBearing: 33.75 },
        { label: 'N7', startBearing: 45 },
        { label: 'N8', startBearing: 56.25 },
        // E zones
        { label: 'E1', startBearing: 67.5 },
        { label: 'E2', startBearing: 78.75 },
        { label: 'E3', startBearing: 90 },
        { label: 'E4', startBearing: 101.25 },
        { label: 'E5', startBearing: 112.5 },
        { label: 'E6', startBearing: 123.75 },
        { label: 'E7', startBearing: 135 },
        { label: 'E8', startBearing: 146.25 },
        // S zones
        { label: 'S1', startBearing: 157.5 },
        { label: 'S2', startBearing: 168.75 },
        { label: 'S3', startBearing: 180 },
        { label: 'S4', startBearing: 191.25 },
        { label: 'S5', startBearing: 202.5 },
        { label: 'S6', startBearing: 213.75 },
        { label: 'S7', startBearing: 225 },
        { label: 'S8', startBearing: 236.25 },
        // W zones
        { label: 'W1', startBearing: 247.5 },
        { label: 'W2', startBearing: 258.75 },
        { label: 'W3', startBearing: 270 },
        { label: 'W4', startBearing: 281.25 },
        { label: 'W5', startBearing: 292.5 },
        { label: 'W6', startBearing: 303.75 },
        { label: 'W7', startBearing: 315 },
        { label: 'W8', startBearing: 326.25 },
    ];

    const zoneLabelR = radius * 1.1;  // Between inner rings
    zones.forEach(zone => {
        // Center of zone = startBearing + 5.625°
        const centerBearing = zone.startBearing + 5.625;
        const angle = bearingToAngle(centerBearing);
        const isCardinal = zone.label.endsWith('3') || zone.label.endsWith('4') || zone.label.endsWith('5') || zone.label.endsWith('6');
        const bgColor = isCardinal ? '#E8F4FD' : undefined;
        const label = createTextSprite(THREE, zone.label, '#1a1a2e', 20, bgColor);
        if (label) {
            label.position.set(
                Math.cos(angle) * zoneLabelR,
                Math.sin(angle) * zoneLabelR,
                0
            );
            group.add(label);
        }
    });

    // ─── 8. 16-DIRECTION COMPASS LABELS ──────────────────────────────────────
    const compassDirections = [
        { label: 'NORTH', bearing: 0, color: '#D62828', fontSize: 32, isCardinal: true },
        { label: 'NNE', bearing: 22.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'NE', bearing: 45, color: '#333333', fontSize: 26, isCardinal: false },
        { label: 'ENE', bearing: 67.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'EAST', bearing: 90, color: '#1a1a2e', fontSize: 32, isCardinal: true },
        { label: 'ESE', bearing: 112.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'SE', bearing: 135, color: '#333333', fontSize: 26, isCardinal: false },
        { label: 'SSE', bearing: 157.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'SOUTH', bearing: 180, color: '#1a1a2e', fontSize: 32, isCardinal: true },
        { label: 'SSW', bearing: 202.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'SW', bearing: 225, color: '#333333', fontSize: 26, isCardinal: false },
        { label: 'WSW', bearing: 247.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'WEST', bearing: 270, color: '#1a1a2e', fontSize: 32, isCardinal: true },
        { label: 'WNW', bearing: 292.5, color: '#555555', fontSize: 22, isCardinal: false },
        { label: 'NW', bearing: 315, color: '#333333', fontSize: 26, isCardinal: false },
        { label: 'NNW', bearing: 337.5, color: '#555555', fontSize: 22, isCardinal: false },
    ];

    const dirLabelR = radius * 1.22;
    compassDirections.forEach(dir => {
        const angle = bearingToAngle(dir.bearing);
        const label = createTextSprite(THREE, dir.label, dir.color, dir.fontSize);
        if (label) {
            label.position.set(
                Math.cos(angle) * dirLabelR,
                Math.sin(angle) * dirLabelR,
                0
            );
            group.add(label);
        }
    });

    // ─── 9. CARDINAL DIRECTION LINES (N/S/E/W) ───────────────────────────────
    [0, 90, 180, 270].forEach(bearing => {
        const angle = bearingToAngle(bearing);
        const isNorth = bearing === 0;
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * 1.35, 0)
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: isNorth ? 0xD62828 : 0x333333,
            transparent: true,
            opacity: 0.6,
            depthTest: false
        });
        group.add(new THREE.Line(geo, mat));
    });

    // ─── 10. CENTER DOT ───────────────────────────────────────────────────────
    const centerGeo = new THREE.CircleGeometry(radius * 0.02, 16);
    const centerMat = new THREE.MeshBasicMaterial({
        color: 0x333333, transparent: false, depthTest: false
    });
    group.add(new THREE.Mesh(centerGeo, centerMat));

    console.log('🧭 Vastu Shakti Chakra: Full compass rose with 32 zones rendered.');
    return group;
}

export const VASTU_ZONES = [
    'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8',
    'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
    'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'
];
