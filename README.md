# SantaDice

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 9.0.7.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The app will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory. Use the `--prod` flag for a production build.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via [Protractor](http://www.protractortest.org/).

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI README](https://github.com/angular/angular-cli/blob/master/README.md).

## Docker

Images are built by GitHub Actions and pushed to `ghcr.io/torsten-simon/santa-dice` (tags: `latest`, branch, `sha-…`, semver on `v*` tags).

```sh
docker run -d -p 8080:80 -v santa-dice-data:/data -e ADMIN_TOKEN=<secret> ghcr.io/torsten-simon/santa-dice:latest
```

Data and uploaded images are stored in `/data` (configurable via `DATA_DIR`). The admin area is at `/#/admin` and requires `ADMIN_TOKEN`; without it, admin actions are disabled.

## Local development

```sh
npm run backend   # PHP backend on :8081 (src/api.php is mounted live)
npm start         # ng serve on :4200, proxies /api.php to the backend
```

`npm run backend:reset` stops the backend and deletes its data volume, `npm run backend:seed` loads test data (`dev/seed.json` + `dev/uploads/`) into the running backend.

The dev backend pins "today" to `2026-12-08` (override with `FAKE_TODAY=2026-12-15 npm run backend`) and uses the admin token `dev`.
