import { Component } from '@angular/core';
import { ApiService } from './api.service';
import { FxService } from './fx/fx.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  constructor(public api: ApiService, public fx: FxService) {
    api.startPolling();
  }
}
