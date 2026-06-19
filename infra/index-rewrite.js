// CloudFront Function (runtime: cloudfront-js-2.0), viewer-request.
// - Protect the private `_meta/` prefix: any "/_*" path returns 403.
// - Subdirectory index: CloudFront's Default Root Object applies only to "/",
//   so append "index.html" for trailing-slash or extensionless URIs.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.indexOf("/_") === 0) {
    return { statusCode: 403, statusDescription: "Forbidden" };
  }

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
    if (lastSegment.indexOf(".") === -1) {
      request.uri = uri + "/index.html";
    }
  }

  return request;
}
