import { WebSocket } from 'ws';

interface Room {
  userId: string;
  desktop: WebSocket | null;
  mobiles: Set<WebSocket>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  getOrCreateRoom(userId: string): Room {
    if (!this.rooms.has(userId)) {
      this.rooms.set(userId, { userId, desktop: null, mobiles: new Set() });
    }
    return this.rooms.get(userId)!;
  }

  addDesktop(userId: string, ws: WebSocket): void {
    const room = this.getOrCreateRoom(userId);
    // 기존 데스크탑 연결 정리
    if (room.desktop && room.desktop.readyState === WebSocket.OPEN) {
      room.desktop.close(1000, 'Replaced by new desktop connection');
    }
    room.desktop = ws;
  }

  addMobile(userId: string, ws: WebSocket): void {
    const room = this.getOrCreateRoom(userId);
    room.mobiles.add(ws);
  }

  removeConnection(userId: string, ws: WebSocket): void {
    const room = this.rooms.get(userId);
    if (!room) return;

    if (room.desktop === ws) {
      room.desktop = null;
    }
    room.mobiles.delete(ws);

    // 빈 룸 정리
    if (room.desktop === null && room.mobiles.size === 0) {
      this.rooms.delete(userId);
    }
  }

  broadcastToMobiles(userId: string, message: string): void {
    const room = this.rooms.get(userId);
    if (!room) return;

    for (const mobile of room.mobiles) {
      if (mobile.readyState === WebSocket.OPEN) {
        mobile.send(message);
      }
    }
  }

  sendToDesktop(userId: string, message: string): void {
    const room = this.rooms.get(userId);
    if (!room || !room.desktop) return;

    if (room.desktop.readyState === WebSocket.OPEN) {
      room.desktop.send(message);
    }
  }

  getRoomCount(): number {
    return this.rooms.size;
  }
}

export const roomManager = new RoomManager();
