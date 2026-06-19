locals {
  publisher_policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.site.arn
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      }
    ]
  })
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "region" {
  value = var.aws_region
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "site_domain" {
  value = local.site_domain
}

output "publisher_policy_json" {
  value = local.publisher_policy_json
}

output "publisher_access_key_id" {
  value     = var.create_publisher_user ? aws_iam_access_key.publisher[0].id : null
  sensitive = true
}

output "publisher_secret_access_key" {
  value     = var.create_publisher_user ? aws_iam_access_key.publisher[0].secret : null
  sensitive = true
}
