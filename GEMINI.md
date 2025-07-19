- README.md briefly specifies the purpose of the project.
- /docs/tech-spec.md is the technical specification.

The /src folder contains the source files. Note that many of the files in here are experimental and should be ignored. The only source files to concern yourself with are:

- index.html
- CylinderClock.js
- CylinderClock.worker.js

When implementing new features, don't take the opportunity to make unrelated changes to existing code unless they are relevant to the new feature. In particular, don't remove what you may consider to be redundant comments. Refactoring existing code is fine when this relates to implementing the new feature.

Target browsers: Only the latest versions of Chrome, Firefox and Safari need to be targeted.
