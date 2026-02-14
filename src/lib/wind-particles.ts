import { WindField, WindVector } from './wind-field';

export interface Particle {
    x: number;        // Longitude
    y: number;        // Latitude
    age: number;      // Current age in frames
    maxAge: number;   // Maximum age before recycling
    trail: { x: number, y: number }[]; // Trail points
    speed: number;    // Current speed
}

export interface ParticleSystemOptions {
    particleCount: number;
    trailLength: number;
    maxAge: number;
    spawnRate: number; // Particles per second
    bounds: {
        minLng: number;
        maxLng: number;
        minLat: number;
        maxLat: number;
    };
}

/**
 * Particle system for wind streamline visualization
 */
export class WindParticleSystem {
    private particles: Particle[];
    private windField: WindField;
    private options: ParticleSystemOptions;
    private particlePool: Particle[];
    private lastSpawnTime: number = 0;

    constructor(windField: WindField, options: Partial<ParticleSystemOptions> = {}) {
        this.windField = windField;
        this.options = {
            particleCount: options.particleCount ?? 800,
            trailLength: options.trailLength ?? 25,
            maxAge: options.maxAge ?? 120, // frames
            spawnRate: options.spawnRate ?? 10,
            bounds: options.bounds ?? {
                minLng: 0,
                maxLng: 1,
                minLat: 0,
                maxLat: 1
            }
        };

        this.particles = [];
        this.particlePool = [];

        // Initialize particle pool
        for (let i = 0; i < this.options.particleCount; i++) {
            this.particlePool.push(this.createParticle());
        }
    }

    /**
     * Create a new particle at random location
     */
    private createParticle(): Particle {
        const { bounds } = this.options;

        return {
            x: bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng),
            y: bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat),
            age: 0,
            maxAge: this.options.maxAge * (0.8 + Math.random() * 0.4), // Vary lifetime
            trail: [],
            speed: 0
        };
    }

    /**
     * Reset particle to new random position
     */
    private resetParticle(particle: Particle): void {
        const { bounds } = this.options;
        particle.x = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
        particle.y = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
        particle.age = 0;
        particle.maxAge = this.options.maxAge * (0.8 + Math.random() * 0.4);
        particle.trail = [];
        particle.speed = 0;
    }

    /**
     * Update particle positions based on wind field
     */
    update(deltaTime: number): void {
        const { bounds, trailLength } = this.options;

        // Spawn new particles
        const now = performance.now();
        const spawnInterval = 1000 / this.options.spawnRate;

        if (now - this.lastSpawnTime > spawnInterval && this.particles.length < this.options.particleCount) {
            const particle = this.particlePool.pop();
            if (particle) {
                this.resetParticle(particle);
                this.particles.push(particle);
            }
            this.lastSpawnTime = now;
        }

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];

            // Get wind vector at current position
            const wind = this.windField.getVectorAt(p.x, p.y);

            // Convert wind velocity to coordinate delta
            // Approximate: 1 m/s ≈ 0.00001 degrees per frame at 60fps
            const metersPerDegLat = 111320;
            const metersPerDegLng = 111320 * Math.cos(p.y * Math.PI / 180);

            const speedFactor = deltaTime / 16.67; // Normalize to 60fps
            const visualSpeedMultiplier = 0.3; // Slow down for better visualization

            const dx = (wind.vx * visualSpeedMultiplier * speedFactor) / metersPerDegLng;
            const dy = (wind.vy * visualSpeedMultiplier * speedFactor) / metersPerDegLat;

            // Add current position to trail
            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > trailLength) {
                p.trail.shift();
            }

            // Update position
            p.x += dx;
            p.y += dy;
            p.speed = wind.speed;
            p.age++;

            // Check if particle is out of bounds or too old
            if (
                p.x < bounds.minLng || p.x > bounds.maxLng ||
                p.y < bounds.minLat || p.y > bounds.maxLat ||
                p.age > p.maxAge
            ) {
                // Recycle particle
                this.particles.splice(i, 1);
                this.resetParticle(p);
                this.particlePool.push(p);
            }
        }
    }

    /**
     * Get all active particles
     */
    getParticles(): Particle[] {
        return this.particles;
    }

    /**
     * Update bounds (when map viewport changes)
     */
    updateBounds(bounds: ParticleSystemOptions['bounds']): void {
        this.options.bounds = bounds;

        // Remove particles outside new bounds
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (
                p.x < bounds.minLng || p.x > bounds.maxLng ||
                p.y < bounds.minLat || p.y > bounds.maxLat
            ) {
                this.particles.splice(i, 1);
                this.resetParticle(p);
                this.particlePool.push(p);
            }
        }
    }

    /**
     * Clear all particles
     */
    clear(): void {
        while (this.particles.length > 0) {
            const p = this.particles.pop();
            if (p) {
                this.resetParticle(p);
                this.particlePool.push(p);
            }
        }
    }
}
