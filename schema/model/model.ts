// Copyright 2021 TsumiNa
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ApolloError } from 'apollo-server-micro'
import { queryField, objectType, unionType, mutationField, arg, booleanArg, stringArg, list, nonNull } from 'nexus'
import { anyNormalUser, magicNumGenerator, removeNulls, signedSelf } from '../../lib/utils'
import { ClassificationMetricCreateWithModel, RegressionMetricCreateWithModel } from '.'
import { isValidated, splitFilename, reformatName } from './helper'
import prisma from '../../lib/prisma'

/**
 * metrics such as mae, r2, recall
 */
export const Metric = unionType({
  name: 'Metric',
  definition(t) {
    t.members('ClassificationMetric', 'RegressionMetric')
  }
})

/**
 * Model Type
 */
export const Model = objectType({
  name: 'Model',
  definition(t) {
    // from prisma plugin
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.artifact()
    t.model.keywords({ description: 'keywords split by comma or white space' })
    t.model.deprecated()
    t.model.succeed()
    t.model.trainingEnv()
    t.model.trainingInfo()
    t.model.downloads()
    t.model.owner()

    t.field('metrics', {
      type: 'Metric',
      async resolve({ id }, _args, { prisma }) {
        const metrics = await prisma.model.findUnique({
          where: { id },
          select: {
            regMetric: true,
            clsMetric: true
          }
        })
        return metrics?.clsMetric || metrics?.regMetric || null
      }
    })

    // computed fields
    t.string('descriptor', {
      description: 'name of descriptor',
      async resolve({ descriptorId }, _args, { prisma }) {
        if (Boolean(descriptorId)) {
          const ret = await prisma.descriptor.findUnique({
            where: { id: descriptorId! },
            select: {
              name: true
            }
          })
          return removeNulls(ret?.name)
        }
        return undefined
      }
    })

    t.string('method', {
      description: 'name of method',
      async resolve({ methodId }, _args, { prisma }) {
        if (Boolean(methodId)) {
          const ret = await prisma.method.findUnique({
            where: { id: methodId! },
            select: {
              name: true
            }
          })
          return removeNulls(ret?.name)
        }
        return undefined
      }
    })

    t.string('property', {
      description: 'name of property',
      async resolve({ propertyId }, _args, { prisma }) {
        if (Boolean(propertyId)) {
          const ret = await prisma.property.findUnique({
            where: { id: propertyId! },
            select: {
              name: true
            }
          })
          return removeNulls(ret?.name)
        }
        return undefined
      }
    })

    t.string('modelset', {
      description: 'name of modelset',
      async resolve({ setId }, _args, { prisma }) {
        if (Boolean(setId)) {
          const ret = await prisma.modelset.findUnique({
            where: { id: setId! },
            select: {
              name: true
            }
          })
          return removeNulls(ret?.name)
        }
        return undefined
      }
    })
  }
})

/**
 * Model url type
 */
export const ModelUrl = objectType({
  name: 'ModelUrl',
  definition(t) {
    t.string('url', { nullable: false }), t.int('id', { nullable: false })
  }
})

/**
 * Get Model info and download link
 */
export const QueryModel = queryField(t => {
  // private models should be protected
  t.crud.model()
  t.crud.models({
    filtering: {
      id: true,
      keywords: true,
      deprecated: true,
      succeed: true,
      property: true,
      propertyId: true,
      descriptor: true,
      descriptorId: true,
      method: true,
      methodId: true,
      modelset: true,
      setId: true,
      clsMetric: true,
      regMetric: true
    },
    ordering: true,
    pagination: true,
    complexity: 2,
    // TODO: check private logic
    computedInputs: {
      private: async () => ({
        equals: false
      })
    },
    resolve: async (root, args, ctx, info, originalResolve) => {
      console.log('logic before the resolver')
      console.log(JSON.stringify(args))
      const res = await originalResolve(root, args, ctx, info)
      console.log('logic after the resolver')
      return res
    }
  })

  t.field('getModelUrls', {
    type: ModelUrl,
    list: true,
    nullable: false,
    args: {
      ids: arg({ type: nonNull(list(nonNull('Int'))), description: 'id of Models' }),
      orderBy: arg({ type: list(nonNull('ModelOrderByInput')) })
    },

    async resolve(_parent, { ids, orderBy }, { prisma, minio }) {
      await prisma.model.updateMany({
        where: { id: { in: ids } },
        data: {
          downloads: { increment: 1 }
        }
      })

      // findMany returns in a semi random order
      // user has to resort the result by himself
      const models = await prisma.model.findMany({
        where: { id: { in: ids } },
        orderBy: removeNulls(orderBy),
        select: {
          id: true,
          artifact: {
            select: {
              path: true
            }
          }
        }
      })

      return Promise.all(
        models.map(async s => {
          const { id, artifact } = s
          const signedUrl = await minio.presignedGetObject(process.env.MINIO_MDL_BUCKET ?? 'mdl', artifact.path) // expires in 7 days
          if (process.env.NODE_ENV === 'production') {
            const base_url = new URL(process.env.BASE_URL ?? 'http://localhost:3000')
            const temp_url = new URL(signedUrl)
            // replace internal host with external
            base_url.pathname = temp_url.pathname
            base_url.search = temp_url.search

            return { id, url: base_url.href }
          }
          return { id, url: signedUrl }
        })
      )
    }
  })
})

export const MutationModel = mutationField(t => {
  t.crud.deleteManyModel({
    // any normal/super user can delete models
    authorize: signedSelf(prisma.model.findMany, true),

    // use custom resolver
    resolve: async (_root, args, { prisma, minio }) => {
      const artifacts = await prisma.model.findMany({
        where: { ...removeNulls(args.where) },
        select: { id: true, artifact: { select: { path: true } } }
      })
      const paths: string[] = []
      const ids: number[] = []
      artifacts.forEach(s => {
        ids.push(s.id)
        paths.push(s.artifact.path)
      })

      try {
        await minio.removeObjects(process.env.MINIO_MDL_BUCKET || 'mdl', paths)
      } finally {
        const res = await prisma.model.deleteMany({ where: { id: { in: ids } } })
        return res
      }
    }
  })
  t.crud.updateOneModel({
    // any owner can update model infos
    authorize: signedSelf(prisma.model.findUnique),

    // use custom resolver
    resolve: async (_root, args, { prisma }) => {
      const model = await prisma.model.update({
        where: { ...removeNulls(args.where) },
        data: { ...removeNulls(args.data) }
      })
      return model
    }
  })
  t.crud.updateManyModel({
    // any owner can update model infos
    authorize: signedSelf(prisma.model.findMany),

    // use custom resolver
    resolve: async (_root, args, { prisma }) => {
      const models = await prisma.model.updateMany({
        where: { ...removeNulls(args.where) },
        data: { ...removeNulls(args.data) }
      })
      return models
    }
  })
  t.field('uploadModel', {
    type: 'Model',
    nullable: false,
    description: 'Upload a model to MDL server',
    args: {
      // required
      artifact: arg({ type: 'Upload', nullable: false }),

      // keywords or descriptor, at least one is required
      keywords: stringArg(),
      property: arg({ type: 'PropertyCreateOrConnectWithoutOwnerInput' }),

      // create
      regMetric: arg({ type: RegressionMetricCreateWithModel }),
      clsMetric: arg({ type: ClassificationMetricCreateWithModel }),

      // create or connect
      descriptor: arg({ type: 'DescriptorCreateOrConnectWithoutOwnerInput' }),
      method: arg({ type: 'MethodCreateOrConnectWithoutOwnerInput' }),
      modelset: arg({ type: 'ModelsetCreateOrConnectWithoutOwnerInput' }),

      // scale, that can be assigned directly
      deprecated: booleanArg(),
      succeed: booleanArg(),
      training_env: arg({ type: 'Json' }),
      training_info: arg({ type: 'Json' })
    },
    authorize: anyNormalUser, // any normal user can upload models
    async resolve(_parent, { artifact, keywords, regMetric, clsMetric, ...remained }, { minio, uid, prisma }) {
      // check keywords and property
      if (!keywords && !remained.property) {
        throw new ApolloError('upload failed. user have to provide at least one of keywords or property')
      }

      // regMetric and clsMetric are mutually exclusive
      if (regMetric && clsMetric) {
        throw new ApolloError('upload failed. regMetric and clsMetric are mutually exclusive')
      }

      // validation procedure
      // check where to try to match a existing record, if Yes, goto upload
      // if No, check create to confirm a new record can be create, if Yes, goto upl
      // if No, raise Error
      const property = reformatName(remained.property)
      const descriptor = reformatName(remained.descriptor)
      const modelset = reformatName(remained.modelset)
      const method = reformatName(remained.method)

      // if success
      const { deprecated, succeed, training_env, training_info } = remained
      const id = (
        await prisma.model.create({
          data: {
            // scale
            owner: {
              connect: { id: uid }
            },
            deprecated: removeNulls(deprecated),
            succeed: removeNulls(succeed),
            keywords,
            trainingEnv: removeNulls(training_env),
            trainingInfo: removeNulls(training_info),

            // creation
            // be care that we should not assign metrics when they are null
            regMetric: isValidated(regMetric) ? { create: { ...regMetric } } : undefined,
            clsMetric: isValidated(clsMetric) ? { create: { ...clsMetric } } : undefined,

            // create an empty artifact
            artifact: { create: { etag: '', path: '', filename: '', ownerId: uid! } },

            /**
             * TODO: if where matched nothing and creating throw errors, the uploading failed
             * This not an error, but should be improved for user-friendly
             */
            property: {
              connectOrCreate: removeNulls(property)
            },
            descriptor: {
              connectOrCreate: removeNulls(descriptor)
            },
            method: {
              connectOrCreate: removeNulls(method)
            },
            modelset: {
              connectOrCreate: removeNulls(modelset)
            }
          }
        })
      ).id

      /* upload artifact to MinIO */
      const { filename, createReadStream } = await artifact

      // test and split suffix from filename
      const [stem, suffix] = splitFilename(filename)

      // make path
      // match existing have high priority
      const propertyName = property?.where?.name || property?.create?.name || 'unknown.property'
      const methodName = method?.where?.name || method?.create?.name || 'unknown.method'
      const descriptorName = descriptor?.where?.name || descriptor?.create?.name || 'unknown.descriptor'
      const modelsetName = modelset?.where?.name || modelset?.create?.name || 'unknown.modelset'
      const magic_num = await magicNumGenerator()
      const path = `${modelsetName}/${propertyName}/${descriptorName}/${methodName}/${stem}-$${magic_num}${suffix}`

      // upload
      const stream = createReadStream()
      try {
        const etag = await minio.putObject(process.env.MINIO_MDL_BUCKET || 'mdl', path, stream)
        return await prisma.model.update({
          where: { id },
          data: { artifact: { update: { etag, path, filename } } }
        })
      } catch (err) {
        console.error(err.message)
        await prisma.model.delete({ where: { id } })
        await minio.removeObject(process.env.MINIO_MDL_BUCKET || 'mdl', path)
        throw new ApolloError(`Error occurred in artifact uploading: ${err.message}`)
      }
    }
  })
})
