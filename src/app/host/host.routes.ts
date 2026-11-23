import { Routes } from '@angular/router';
import { HostBankComponent } from './host-bank.component';
import { HostRoomsComponent } from './host-rooms.component';
import { SharedSetComponent } from './shared-set.component';

export const HOST_ROUTES: Routes = [
  { path: '', redirectTo: 'rooms', pathMatch: 'full' },
  { path: 'rooms', component: HostRoomsComponent },
  { path: 'bank', component: HostBankComponent },
  {
    path: 'bank/:id',
    component: SharedSetComponent,
    canDeactivate: [(component: SharedSetComponent) => component.canLeave()],
    loadChildren: () => import('../editor/editor.routing').then(m => [
      { path: '', pathMatch: 'full', redirectTo: 'general' },
      ...m.routes.filter(route => route.path !== '' && route.path !== '**'),
    ]),
  },
  { path: 'drafts', data: { hosted: true }, loadComponent: () => import('../editor/editor.component').then(m => m.EditorComponent), loadChildren: () => import('../editor/editor.routing').then(m => m.routes) },
];
