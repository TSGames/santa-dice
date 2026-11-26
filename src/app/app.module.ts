import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule, Routes } from '@angular/router';

import { AppComponent } from './app.component';
import { DieComponent } from './die.component';
import { SnowComponent } from './snow.component';
import { CalendarComponent } from './calendar/calendar.component';
import { DoorComponent } from './door/door.component';
import { AdminComponent } from './admin/admin.component';

const routes: Routes = [
  {path: '', component: CalendarComponent, title: 'Adventskalender'},
  {path: 'tuer/:day', component: DoorComponent, title: 'Türchen – Adventskalender'},
  {path: 'admin', component: AdminComponent, title: 'Admin – Adventskalender'},
  {path: '**', redirectTo: ''},
];

@NgModule({
  declarations: [
    AppComponent,
    DieComponent,
    SnowComponent,
    CalendarComponent,
    DoorComponent,
    AdminComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    RouterModule.forRoot(routes, {useHash: true, scrollPositionRestoration: 'top'}),
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
