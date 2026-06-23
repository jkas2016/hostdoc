# [1.1.0](https://github.com/jkas2016/hostdoc/compare/v1.0.1...v1.1.0) (2026-06-23)


### Features

* make `publish --dry-run` AWS-free (offline URL preview) ([#11](https://github.com/jkas2016/hostdoc/issues/11)) ([#12](https://github.com/jkas2016/hostdoc/issues/12)) ([c7109eb](https://github.com/jkas2016/hostdoc/commit/c7109eb5fa3f5acfbb5bb61b8b3cb30fe1f8ae05))
* wrap the hostdoc CLI as an installable agent skill ([#5](https://github.com/jkas2016/hostdoc/issues/5)) ([#10](https://github.com/jkas2016/hostdoc/issues/10)) ([ec087aa](https://github.com/jkas2016/hostdoc/commit/ec087aaa247b7227d5bd708d9d51d062675fd848))

## [1.0.1](https://github.com/jkas2016/hostdoc/compare/v1.0.0...v1.0.1) (2026-06-22)


### Bug Fixes

* bundle Terraform templates so npm-installed users can run provision ([#8](https://github.com/jkas2016/hostdoc/issues/8)) ([#9](https://github.com/jkas2016/hostdoc/issues/9)) ([a249347](https://github.com/jkas2016/hostdoc/commit/a249347d40f36977f2f1296e1206eb7555769266))

# 1.0.0 (2026-06-19)


### Bug Fixes

* add repository field so npm OIDC provenance validates ([0a0e4ca](https://github.com/jkas2016/hostdoc/commit/0a0e4ca052813ad504bfffd949cc34eff679c9b5))
* CLI option wiring, bucket policy, and config endpoint (first-run bugs) ([b5238b0](https://github.com/jkas2016/hostdoc/commit/b5238b037bcbf045821cc0bbb1c741e31667963e))


### Features

* add \`init --from-terraform\` to import cloudfront config ([35e85ba](https://github.com/jkas2016/hostdoc/commit/35e85ba0712cd2fafdcf09e4934b6c1cb8371efa))
* add hostdoc deprovision (CLI-driven terraform destroy) with --approve ([7989ab3](https://github.com/jkas2016/hostdoc/commit/7989ab36048ce2200aa77a7fd358c6cc82872d80))
* add hostdoc provision (CLI-driven terraform apply) with --approve ([8fe49db](https://github.com/jkas2016/hostdoc/commit/8fe49dbbb8d51bdd102a0fd95690143b93784cb6))
* CloudFront Function for subdir index + /_* 403 ([8f7879d](https://github.com/jkas2016/hostdoc/commit/8f7879d9cfb0da46ae4b0d4f87e14448fe36f61d))
* CloudFront invalidation helper with throttle backoff ([806158f](https://github.com/jkas2016/hostdoc/commit/806158fbcb4ae60a6afe45019c376712b1ed2a50))
* hostdoc — self-hosted document publish CLI (Phase 1) ([67dfab4](https://github.com/jkas2016/hostdoc/commit/67dfab4d16276bb2d78509c520a387c493b01801))
* Terraform module for CloudFront/ACM/Route53 domain mode ([09c9f6c](https://github.com/jkas2016/hostdoc/commit/09c9f6c500f0907154b5b9cd88774d1e8c2db2f8))
* wire CloudFront invalidation into publish (overwrite) and rm ([6dd7860](https://github.com/jkas2016/hostdoc/commit/6dd78607d9b41239366e2085a4ea7f0486d82c48))
