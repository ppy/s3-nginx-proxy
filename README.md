# s3-nginx-proxy [![dev chat](https://discordapp.com/api/guilds/188630481301012481/widget.png?style=shield)](https://discord.gg/ppy)

A feature-rich Amazon S3 NGINX-based proxy, running in Docker and Kubernetes.

# Features

- Authentication to private buckets
- Multiple buckets
- Multiple domains per buckets
- Multiple regions
- Shared cache
- Auto-reload after every configuration update (in production too)

# Usage

Recommended setup is to create an AWS IAM user for each `s3-nginx-proxy` deployment. You should then attach a policy to exclusively grant it the `GetObject` permission on the required buckets, such as:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisualEditor0",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::thepoon.ppy.sh/*"
    }
  ]
}
```

Granting too much permissions may lead to security risks (such as listing the entire bucket content). Be careful!

## Docker

Change directory to `docker`.  
Edit `./data/etc/proxy-config/virtualhosts.json` and `./data/etc/proxy-config/cache.json` to match your desired settings.
Put your AWS credentials in `./data/etc/s3-credentials/s3AccessKey` and `./data/etc/s3-credentials/s3SecretKey`.
Start the NGINX and config generator containers with `docker-compose up -d`.

## Kubernetes (Helm)

Edit your AWS credentials, proxy and ingress config in `s3-nginx-proxy-chart/values.yaml` and deploy like any other Helm chart.

# Contributing

This project is very bare-bones for now; a sort of Minimum Viable Product.  
Planned features are the ability to purge cache (both full and specific key), and more configuration options.

Contributions can be made via pull requests to this repository. We hope to credit and reward larger contributions via a [bounty system](https://www.bountysource.com/teams/ppy). If you're unsure of what you can help with, check out the [list of open issues](https://github.com/ppy/s3-nginx-proxy/issues).

Note that while we already have certain standards in place, nothing is set in stone. If you have an issue with the way code is structured; with any libraries we are using; with any processes involved with contributing, *please* bring it up. I welcome all feedback so we can make contributing to this project as pain-free as possible.

# Licence

The osu! client code, framework, and server-side components are licensed under the [MIT licence](https://opensource.org/licenses/MIT). Please see [the licence file](LICENCE) for more information. [tl;dr](https://tldrlegal.com/license/mit-license) you can do whatever you want as long as you include the original copyright and license notice in any copy of the software/source.

Please note that this *does not cover* the usage of the "osu!" or "ppy" branding in any software, resources, advertising or promotion, as this is protected by trademark law.
