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
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront price class: PriceClass_100 (cheapest; NA+EU), PriceClass_200, or PriceClass_All."
  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All."
  }
}

variable "create_publisher_user" {
  type        = bool
  default     = false
  description = "Create a dedicated least-privilege IAM publisher user + access key. The secret is stored in plaintext in terraform.tfstate — keep state private and rotate/destroy the key when done (see outputs.tf)."
}
