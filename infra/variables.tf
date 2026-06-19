variable "hosted_zone_name" {
  type        = string
  description = "Existing Route53 hosted zone (looked up via data source)."
}

variable "subdomain" {
  type        = string
  description = "Subdomain; the site is <subdomain>.<hosted_zone_name>."
}

variable "aws_region" {
  type        = string
  description = "Region for the S3 bucket (the ACM cert is always us-east-1)."
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "create_publisher_user" {
  type    = bool
  default = false
}
