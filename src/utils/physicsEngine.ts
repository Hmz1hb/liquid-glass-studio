export interface PhysicsBody {
  id: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  width: number;
  height: number;
  mass: number;
  damping: number;
  restX: number;
  restY: number;
  springStiffness: number;
}

export class PhysicsEngine {
  private bodies: Map<string, PhysicsBody> = new Map();
  private gravity = 0;
  private globalDamping = 0.98;
  private enabled = false;

  setEnabled(enabled: boolean) { this.enabled = enabled; }
  isEnabled() { return this.enabled; }
  setGravity(g: number) { this.gravity = g; }
  setGlobalDamping(d: number) { this.globalDamping = d; }

  addBody(id: string, x: number, y: number, width: number, height: number, stiffness = 0.02): PhysicsBody {
    const body: PhysicsBody = {
      id, x, y, prevX: x, prevY: y, width, height,
      mass: 1, damping: 0.95, restX: x, restY: y,
      springStiffness: stiffness,
    };
    this.bodies.set(id, body);
    return body;
  }

  removeBody(id: string) { this.bodies.delete(id); }

  setPosition(id: string, x: number, y: number) {
    const body = this.bodies.get(id);
    if (body) {
      body.x = x;
      body.y = y;
      body.prevX = x;
      body.prevY = y;
      body.restX = x;
      body.restY = y;
    }
  }

  applyImpulse(id: string, vx: number, vy: number) {
    const body = this.bodies.get(id);
    if (body) {
      body.prevX -= vx;
      body.prevY -= vy;
    }
  }

  step(dt = 1 / 60): Map<string, { x: number; y: number }> {
    const results = new Map<string, { x: number; y: number }>();
    if (!this.enabled) return results;

    for (const [id, body] of this.bodies) {
      // Verlet integration
      let vx = (body.x - body.prevX) * body.damping * this.globalDamping;
      let vy = (body.y - body.prevY) * body.damping * this.globalDamping;

      // Spring force to rest position
      const dx = body.restX - body.x;
      const dy = body.restY - body.y;
      vx += dx * body.springStiffness;
      vy += dy * body.springStiffness;

      // Gravity
      vy += this.gravity * dt;

      body.prevX = body.x;
      body.prevY = body.y;
      body.x += vx;
      body.y += vy;

      results.set(id, { x: body.x, y: body.y });
    }

    // Simple collision between bodies
    const bodyList = Array.from(this.bodies.values());
    for (let i = 0; i < bodyList.length; i++) {
      for (let j = i + 1; j < bodyList.length; j++) {
        this.resolveCollision(bodyList[i], bodyList[j]);
      }
    }

    return results;
  }

  private resolveCollision(a: PhysicsBody, b: PhysicsBody) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDist = (a.width + b.width) * 0.3;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist && dist > 0) {
      const overlap = (minDist - dist) * 0.5;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
    }
  }

  getBody(id: string) { return this.bodies.get(id); }
  getBodyIds(): IterableIterator<string> { return this.bodies.keys(); }
  clear() { this.bodies.clear(); }
}
