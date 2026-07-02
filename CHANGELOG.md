# [1.2.0](https://github.com/jkas2016/hostdoc/compare/v1.1.1...v1.2.0) (2026-07-02)


### Bug Fixes

* clean up nested child _meta sidecars on prefix delete/overwrite ([#37](https://github.com/jkas2016/hostdoc/issues/37)) ([#40](https://github.com/jkas2016/hostdoc/issues/40)) ([a18b42b](https://github.com/jkas2016/hostdoc/commit/a18b42be50c2e50d8adf900c3df89ef3a78f7976)), closes [#7](https://github.com/jkas2016/hostdoc/issues/7)
* rm/open이 기본 랜덤 코드(대문자 포함)를 거부하는 버그 ([#33](https://github.com/jkas2016/hostdoc/issues/33)) ([#34](https://github.com/jkas2016/hostdoc/issues/34)) ([ef27f7d](https://github.com/jkas2016/hostdoc/commit/ef27f7d31589b28ba339331d21cc3e7491a379e0))
* uniform code generation + dedup infra preamble/template list ([#21](https://github.com/jkas2016/hostdoc/issues/21)) ([#35](https://github.com/jkas2016/hostdoc/issues/35)) ([0182153](https://github.com/jkas2016/hostdoc/commit/018215317b70bea84497b8f8628d9dce54c6df8d))


### Features

* add --version / -v flag to the CLI ([0d2b5a6](https://github.com/jkas2016/hostdoc/commit/0d2b5a6c4345c321bebfe013cd94db87dc393dd7))
* nested/multi-segment custom paths in publish/rm/open ([#38](https://github.com/jkas2016/hostdoc/issues/38)) ([a18ff4c](https://github.com/jkas2016/hostdoc/commit/a18ff4c17db5ef8b66fd002ba836490feaf7ebea)), closes [#37](https://github.com/jkas2016/hostdoc/issues/37)


### Performance Improvements

* parallelize independent I/O in publish (uploads + walk) ([#19](https://github.com/jkas2016/hostdoc/issues/19)) ([#32](https://github.com/jkas2016/hostdoc/issues/32)) ([e5532e6](https://github.com/jkas2016/hostdoc/commit/e5532e618c52f52b34d3cfdeae46896999f20c39))

## [1.1.1](https://github.com/jkas2016/hostdoc/compare/v1.1.0...v1.1.1) (2026-06-25)


### Bug Fixes

* harden CLI failure paths (publish --open override, browser spawn, dev-mode templates) ([#17](https://github.com/jkas2016/hostdoc/issues/17)) ([#28](https://github.com/jkas2016/hostdoc/issues/28)) ([1cb8dda](https://github.com/jkas2016/hostdoc/commit/1cb8ddaf0787c148c56c664c47525a256dec5202))
* harden config parsing and reject partial cloudfront config ([#15](https://github.com/jkas2016/hostdoc/issues/15)) ([#27](https://github.com/jkas2016/hostdoc/issues/27)) ([eab32db](https://github.com/jkas2016/hostdoc/commit/eab32db73869d270772380cbe829366d68e52988))
* harden the agent skill wrapper (signals, exit code, preflight) ([#18](https://github.com/jkas2016/hostdoc/issues/18)) ([#29](https://github.com/jkas2016/hostdoc/issues/29)) ([bffef1b](https://github.com/jkas2016/hostdoc/commit/bffef1bbac12415f6ff49672143ebabb5405e9a6))
* make list resilient to corrupt or incomplete sidecars ([#23](https://github.com/jkas2016/hostdoc/issues/23)) ([79186cd](https://github.com/jkas2016/hostdoc/commit/79186cda44f6d33dbb00adb1284ef0a64d025f17)), closes [#14](https://github.com/jkas2016/hostdoc/issues/14)
* validate rm/open id and gate rm behind a confirmation prompt ([#22](https://github.com/jkas2016/hostdoc/issues/22)) ([21c240a](https://github.com/jkas2016/hostdoc/commit/21c240ad594e96aea9835901d3e369a936acbafb)), closes [#13](https://github.com/jkas2016/hostdoc/issues/13)
* write terraform.tfvars.json to prevent HCL template injection ([#24](https://github.com/jkas2016/hostdoc/issues/24)) ([031d3d7](https://github.com/jkas2016/hostdoc/commit/031d3d7b68802e452d2c6d32ff1d014fab9df105)), closes [#16](https://github.com/jkas2016/hostdoc/issues/16)

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
