import React from 'react';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// 라우터 인스턴스 생성
const router = createRouter({ routeTree });

// 타입 안전성을 위한 모듈 선언
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export default function App(): React.ReactElement {
  return <RouterProvider router={router} />;
}
