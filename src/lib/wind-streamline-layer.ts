import mapboxgl from 'mapbox-gl';
import { WindField } from './wind-field';
import { WindParticleSystem, Particle } from './wind-particles';
import type { Building } from './types';

/**
 * Custom Mapbox layer for rendering animated wind streamlines
 */
export class WindStreamlineLayer implements mapboxgl.CustomLayerInterface {
    id: string;
    type: 'custom' = 'custom';
    renderingMode: '2d' | '3d' = '2d';

    private map?: mapboxgl.Map;
    private canvas?: HTMLCanvasElement;
    private ctx?: CanvasRenderingContext2D;
    private windField?: WindField;
    private particleSystem?: WindParticleSystem;
    private animationFrameId?: number;
    private lastFrameTime: number = 0;

    // WebGL resources
    private gl?: WebGLRenderingContext;
    private program?: WebGLProgram;
    private texture?: WebGLTexture;
    private positionBuffer?: WebGLBuffer;

    constructor(id: string = 'wind-streamlines') {
        this.id = id;
    }

    /**
     * Initialize the layer
     */
    onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.gl = gl;

        // Create canvas element for drawing particles
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true })!;

        // Initialize WebGL resources
        this.initWebGL(gl);

        // Start animation loop
        this.startAnimation();
    }

    /**
     * Initialize WebGL shaders and buffers
     */
    private initWebGL(gl: WebGLRenderingContext): void {
        // Vertex shader - simple passthrough
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment shader - sample texture
        const fragmentShaderSource = `
            precision mediump float;
            uniform sampler2D u_texture;
            varying vec2 v_texCoord;
            
            void main() {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        `;

        // Compile shaders
        const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

        if (!vertexShader || !fragmentShader) return;

        // Create program
        this.program = gl.createProgram()!;
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program link failed:', gl.getProgramInfoLog(this.program));
            return;
        }

        // Create texture
        this.texture = gl.createTexture()!;

        // Create position buffer (fullscreen quad)
        this.positionBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        const positions = new Float32Array([
            -1, -1, 0, 1,  // bottom-left
            1, -1, 1, 1,  // bottom-right
            -1, 1, 0, 0,  // top-left
            1, 1, 1, 0   // top-right
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    }

    /**
     * Create and compile shader
     */
    private createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    /**
     * Initialize wind field and particle system
     */
    initialize(buildings: Building[], windDirection: number = 45): void {
        if (!this.map) return;

        console.log('[WIND STREAMLINES] Initializing with', buildings.length, 'buildings');

        // Create wind field
        this.windField = new WindField(buildings, {
            windDirection,
            baseSpeed: 3.5,
            turbulenceScale: 0.3,
            wakeLength: 5.0
        });

        // Get map bounds
        const bounds = this.map.getBounds();
        if (!bounds) return;

        // Create particle system
        this.particleSystem = new WindParticleSystem(this.windField, {
            particleCount: 800,
            trailLength: 25,
            maxAge: 120,
            spawnRate: 10,
            bounds: {
                minLng: bounds.getWest(),
                maxLng: bounds.getEast(),
                minLat: bounds.getSouth(),
                maxLat: bounds.getNorth()
            }
        });

        console.log('[WIND STREAMLINES] Initialized successfully');
    }

    /**
     * Start animation loop
     */
    private startAnimation(): void {
        const animate = (timestamp: number) => {
            if (!this.map || !this.particleSystem) {
                this.animationFrameId = requestAnimationFrame(animate);
                return;
            }

            const deltaTime = this.lastFrameTime ? timestamp - this.lastFrameTime : 16.67;
            this.lastFrameTime = timestamp;

            // Update particles
            this.particleSystem.update(deltaTime);

            // Trigger map repaint
            this.map.triggerRepaint();

            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    /**
     * Render the layer
     */
    render(gl: WebGLRenderingContext, matrix: number[]): void {
        if (!this.map || !this.canvas || !this.ctx || !this.particleSystem || !this.program || !this.texture) return;

        const mapCanvas = this.map.getCanvas();

        // Resize canvas to match map
        if (this.canvas.width !== mapCanvas.width || this.canvas.height !== mapCanvas.height) {
            this.canvas.width = mapCanvas.width;
            this.canvas.height = mapCanvas.height;
        }

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Get particles
        const particles = this.particleSystem.getParticles();

        // Render each particle trail to canvas
        for (const particle of particles) {
            this.renderParticleTrail(particle);
        }

        // Upload canvas to WebGL texture
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Use shader program
        gl.useProgram(this.program);

        // Enable blending for transparency
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Bind position buffer
        const positionLocation = gl.getAttribLocation(this.program, 'a_position');
        const texCoordLocation = gl.getAttribLocation(this.program, 'a_texCoord');

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer!);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

        // Set texture uniform
        const textureLocation = gl.getUniformLocation(this.program, 'u_texture');
        gl.uniform1i(textureLocation, 0);

        // Draw fullscreen quad
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Cleanup
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(texCoordLocation);
        gl.disable(gl.BLEND);
    }

    /**
     * Render a single particle trail
     */
    private renderParticleTrail(particle: Particle): void {
        if (!this.map || !this.ctx || particle.trail.length < 2) return;

        const trail = particle.trail;

        // Calculate opacity based on age
        const ageRatio = particle.age / particle.maxAge;
        const baseOpacity = Math.max(0, 1 - ageRatio);

        // Speed-based color (blue for slow, white for fast)
        const speedRatio = Math.min(particle.speed / 5, 1);
        const r = Math.floor(100 + speedRatio * 155);
        const g = Math.floor(150 + speedRatio * 105);
        const b = 255;

        this.ctx.beginPath();

        // Convert first point to pixel coordinates
        const firstPoint = this.map.project([trail[0].x, trail[0].y]);
        this.ctx.moveTo(firstPoint.x, firstPoint.y);

        // Draw smooth curve through trail points
        for (let i = 1; i < trail.length; i++) {
            const point = this.map.project([trail[i].x, trail[i].y]);

            if (i === 1) {
                this.ctx.lineTo(point.x, point.y);
            } else {
                const prevPoint = this.map.project([trail[i - 1].x, trail[i - 1].y]);
                const cpX = (prevPoint.x + point.x) / 2;
                const cpY = (prevPoint.y + point.y) / 2;
                this.ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
            }
        }

        // Opacity fades along trail
        const trailOpacity = baseOpacity * 1.0; // Increased from 0.8
        this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${trailOpacity})`;
        this.ctx.lineWidth = 3.5; // Increased from 2
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
    }

    /**
     * Update bounds when map moves
     */
    updateBounds(): void {
        if (!this.map || !this.particleSystem) return;

        const bounds = this.map.getBounds();
        if (!bounds) return;

        this.particleSystem.updateBounds({
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth()
        });
    }

    /**
     * Update wind direction
     */
    updateWindDirection(direction: number): void {
        if (this.windField) {
            this.windField.updateDirection(direction);
        }
    }

    /**
     * Cleanup
     */
    onRemove(): void {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.particleSystem) {
            this.particleSystem.clear();
        }

        // Cleanup WebGL resources
        if (this.gl && this.texture) {
            this.gl.deleteTexture(this.texture);
        }
        if (this.gl && this.program) {
            this.gl.deleteProgram(this.program);
        }
        if (this.gl && this.positionBuffer) {
            this.gl.deleteBuffer(this.positionBuffer);
        }

        this.map = undefined;
        this.canvas = undefined;
        this.ctx = undefined;
        this.gl = undefined;
    }
}
