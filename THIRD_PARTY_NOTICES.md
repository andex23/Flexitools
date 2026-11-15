# Added media dependencies

Dependency licenses also remain in their installed packages and generated JavaScript license notices. These libraries run locally in the browser; no paid API is used.

| Library | Version | License | Source |
| --- | --- | --- | --- |
| Mediabunny | 1.66.0 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| heic-to | 1.6.7 | LGPL-3.0 | https://github.com/hoppergee/heic-to |

HEIC decoding uses the unmodified `heic-to/csp` distribution, based on libheif. Its source, build instructions, and LGPL license are available at the source link above and in the [1.6.7 package](https://www.npmjs.com/package/heic-to/v/1.6.7). The decoder is loaded as a separate lazy chunk. You can replace that dependency and rebuild this open-source application using the documented npm commands. Preserve these notices and the decoder's license when distributing a build. See the package for the licenses of its bundled codec components.

Mediabunny is used without source modifications. Its MPL-covered source and license are available at the source link above. Browser-provided codecs have their own platform licensing; this application does not bundle a paid transcoding service.
